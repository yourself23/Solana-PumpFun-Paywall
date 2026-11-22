const test = require("node:test");
const assert = require("node:assert/strict");

process.env.TREASURY_WALLET = "   ";
process.env.SOLANA_RPC_URL = " https://rpc.example.test ";
process.env.UPSTASH_REDIS_REST_URL = " https://redis.example.test ";
process.env.UPSTASH_REDIS_REST_TOKEN = " token ";
const { TREASURY, USDC_MINT, verifySolPayment, requireGate } = require("../dist/lib/paywall");
const { resolvePaymentSig } = require("../dist/lib/x402-tx");
const mintHandler = require("../dist/api/credits/mint").default;
const sig = "2".repeat(88);
const usdc = (amount, owner = TREASURY, mint = USDC_MINT, accountIndex = 2) => ({ accountIndex, owner, mint, uiTokenAmount: { amount: String(amount) } });
const transaction = (solDelta = 0, pre = [], post = []) => ({
  meta: { err: null, preBalances: [100_000_000], postBalances: [100_000_000 + solDelta], preTokenBalances: pre, postTokenBalances: post },
  transaction: { message: { accountKeys: [{ pubkey: TREASURY }] } },
});
const request = (headers = {}, body) => ({ headers, body, query: {} });
const response = () => ({
  headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

function harness(tx) {
  const calls = [];
  const records = new Map();
  const original = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url === "https://rpc.example.test") {
      if (body.method === "sendTransaction") return Response.json({ result: sig });
      if (body.method === "getTransaction") return Response.json({ result: tx });
      throw new Error(`Unexpected RPC ${body.method}`);
    }
    assert.equal(url, "https://redis.example.test");
    assert.equal(options.headers.Authorization, "Bearer token");
    if (body[0] !== "EVAL") throw new Error(`Unexpected Redis command ${body[0]}`);
    if (body[2] === 6) {
      const keys = body.slice(3, 9);
      const args = body.slice(9);
      assert.match(body[1], /SET.*KEYS\[1\].*NX/);
      assert.doesNotMatch(body[1], /SET.*KEYS\[1\].*EX/);
      if (records.has(keys[0])) return Response.json({ result: 0 });
      records.set(keys[0], args[0]);
      if (args[4]) records.set(keys[5], Number(args[5]));
      return Response.json({ result: 1 });
    }
    const key = body[3];
    const remaining = records.get(key);
    if (!remaining) return Response.json({ result: -1 });
    records.set(key, remaining - 1);
    return Response.json({ result: remaining - 1 });
  };
  return { calls, records, restore: () => { global.fetch = original; } };
}

test("payment headers resolve signatures and broadcast encoded transactions", async () => {
  const h = harness(transaction(5_000_000));
  try {
    assert.equal(TREASURY, "2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2");
    assert.equal(await resolvePaymentSig(` ${sig} `), sig);
    const encodedSig = Buffer.from(JSON.stringify({ payload: { signature: sig } })).toString("base64");
    assert.equal(await resolvePaymentSig(encodedSig), sig);
    const rawTx = Buffer.alloc(100, 1).toString("base64");
    const payload = Buffer.from(JSON.stringify({ payload: { transaction: rawTx } })).toString("base64");
    const res = response();
    assert.equal(await requireGate(request({ "x-payment": payload }), res, 5_000_000, "/api/pump/curve"), true);
    const broadcast = h.calls.find((c) => c.body.method === "sendTransaction").body;
    assert.deepEqual(broadcast.params, [rawTx, { encoding: "base64", skipPreflight: true, preflightCommitment: "confirmed" }]);
    assert.equal(await resolvePaymentSig("not-a-signature"), "");
  } finally { h.restore(); }
});

test("settles SOL and USDC deltas and rejects replay", async () => {
  for (const tx of [transaction(5_000_000), transaction(0, [usdc(100)], [usdc(500_100)])]) {
    const h = harness(tx);
    try {
      const result = await verifySolPayment(sig, 5_000_000, "/api/pump/curve");
      assert.equal(result.ok, true);
      assert.equal(result.lamports, tx.meta.postBalances[0] - tx.meta.preBalances[0]);
      assert.equal(result.usdc_atomic, tx.meta.postTokenBalances.length ? 500_000 : 0);
      assert.match((await verifySolPayment(sig, 5_000_000, "/api/pump/curve")).error, /already redeemed/);
    } finally { h.restore(); }
  }
});

test("rejects insufficient or unrelated token deltas and malformed SOL balances", async () => {
  for (const tx of [
    transaction(4_999_999),
    transaction(0, [usdc(100)], [usdc(500_099)]),
    transaction(0, [], [usdc(500_000, "someone-else")]),
    transaction(0, [], [usdc(500_000, TREASURY, "other-mint")]),
    transaction(0, [usdc(500_000)], [usdc(500_000)]),
  ]) {
    const h = harness(tx);
    try {
      assert.equal((await verifySolPayment(sig, 5_000_000, "/api/pump/curve")).ok, false);
      assert.equal(h.records.size, 0);
    } finally { h.restore(); }
  }
  const bad = transaction(); delete bad.meta.postBalances;
  const h = harness(bad);
  try { await assert.rejects(verifySolPayment(sig, 5_000_000, "/test"), /Invalid treasury SOL balance/); }
  finally { h.restore(); }
});

test("mint accepts an encoded USDC transaction, atomically creates credits, and prevents reuse", async () => {
  const h = harness(transaction(0, [], [usdc(5_000_000)]));
  try {
    const encoded = Buffer.from(JSON.stringify({ payload: { transaction: Buffer.alloc(100, 2).toString("base64") } })).toString("base64");
    const res = response();
    await mintHandler(request({ "x-payment-signature": encoded }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(h.records.get(`pf:key:${res.body.api_key}`), 25);
    const spend = response();
    assert.equal(await requireGate(request({ authorization: `Bearer ${res.body.api_key}` }), spend, 5_000_000, "/curve"), true);
    assert.equal(spend.headers["X-Credits-Remaining"], "24");
    const again = response();
    await mintHandler(request({ "x-payment": sig }), again);
    assert.equal(again.statusCode, 402);
    assert.equal(again.body.x402Version, 2);
  } finally { h.restore(); }
});

test("raw x-payment-signature works and invalid credit passes receive an x402 challenge", async () => {
  const h = harness(transaction(5_000_000));
  try {
    const res = response();
    assert.equal(await requireGate(request({ "x-payment-signature": sig }), res, 5_000_000, "/curve"), true);
    const invalid = response();
    assert.equal(await requireGate(request({ authorization: "Bearer pf_live_invalid" }), invalid, 5_000_000, "/curve"), false);
    assert.equal(invalid.statusCode, 402);
    assert.equal(invalid.body.x402Version, 2);
    assert.equal(h.records.has("pf:key:pf_live_invalid"), false);
  } finally { h.restore(); }
});

test("unconfirmed broadcasts return the signature for retry without rebroadcasting", async () => {
  const h = harness(null);
  try {
    const payload = Buffer.from(JSON.stringify({ payload: { transaction: Buffer.alloc(100, 2).toString("base64") } })).toString("base64");
    const res = response();
    await mintHandler(request({ "x-payment": payload }), res);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.payment_signature, sig);
    assert.equal(h.calls.filter((call) => call.body.method === "sendTransaction").length, 1);
    assert.equal(h.records.size, 0);
  } finally { h.restore(); }
});

test("broadcast and Redis failures are explicit 503 responses", async () => {
  const original = global.fetch;
  const oldError = console.error;
  console.error = () => {};
  try {
    global.fetch = async () => new Response("unavailable", { status: 503 });
    const payload = Buffer.from(JSON.stringify({ payload: { transaction: Buffer.alloc(100, 2).toString("base64") } })).toString("base64");
    const res = response();
    assert.equal(await requireGate(request({ "x-payment": payload }), res, 5_000_000, "/curve"), false);
    assert.equal(res.statusCode, 503);
    const credits = response();
    await mintHandler(request({ "x-payment": payload }), credits);
    assert.equal(credits.statusCode, 503);
  } finally { global.fetch = original; console.error = oldError; }
});
