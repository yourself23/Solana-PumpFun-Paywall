const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchBondingCurve, runRugCheck, computeQuote } = require("../dist/lib/pump");

const vectors = [
  ["So11111111111111111111111111111111111111112", "6PiyjiAPkp2KdZtqkyQYzVsD1Prv7t8v4TaYd8ip4YFd"],
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "8Rr2Qo9ch94zRZxojHfg7Xeq8DfAp9mfNaLZnQScnpbA"],
  ["2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2", "F9St1SHgJ3mQMPCzKNqLQnjuTabxNtWgpaUVgxtYJBwU"],
];

test("PDA derivation matches Solana SDK vectors and rug check uses the largest external holder", async () => {
  const original = global.fetch;
  const data = Buffer.alloc(49);
  data.writeBigUInt64LE(1_000_000_000_000_000n, 8);
  data.writeBigUInt64LE(30_000_000_000n, 16);
  data.writeBigUInt64LE(500_000_000_000_000n, 24);
  data.writeBigUInt64LE(1_000_000_000_000_000n, 40);
  global.fetch = async (_url, options) => {
    const { method, params } = JSON.parse(options.body);
    if (method === "getAccountInfo") {
      assert.ok(vectors.some(([, pda]) => pda === params[0]), `unexpected PDA ${params[0]}`);
      return Response.json({ result: { value: { data: [data.toString("base64"), "base64"] } } });
    }
    if (method === "getTokenLargestAccounts") return Response.json({ result: { value: [
      { address: "curve", amount: "500000000000000" },
      { address: "holder", amount: "150000000000000" },
    ] } });
    if (method === "getSignaturesForAddress") return Response.json({ result: [] });
    throw new Error(`Unexpected RPC ${method}`);
  };
  try {
    for (const [mint, pda] of vectors) assert.equal((await fetchBondingCurve(mint)).bondingCurvePda, pda);
    const rug = await runRugCheck(vectors[0][0]);
    assert.equal(rug.largestExternalHolderPct, 15);
    assert.equal(rug.riskScore, 25);
    await assert.rejects(computeQuote(vectors[0][0], "buy", 0n), /positive/);
  } finally { global.fetch = original; }
});
