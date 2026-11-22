const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, rm } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const server = process.env.REDIS_TEST_SERVER?.trim();
const cli = process.env.REDIS_TEST_CLI?.trim();
const exec = promisify(execFile);

test("settlement scripts prevent concurrent replay and issue spendable credits in Redis", { skip: !server || !cli }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paywall-redis-test-"));
  const socket = path.join(dir, "redis.sock");
  const child = spawn(server, ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  const command = async (...args) => {
    const { stdout } = await exec(cli, ["-s", socket, "--json", "-e", ...args.map(String)]);
    return JSON.parse(stdout);
  };
  const originalFetch = global.fetch;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { await command("PING"); ready = true; break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, "Redis did not start");
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test";
    process.env.SOLANA_RPC_URL = "https://rpc.example.test";
    const { TREASURY, PASS_LAMPORTS, verifySolPayment, requireGate } = require("../dist/lib/paywall");
    const sig = "3".repeat(88);
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url === "https://rpc.example.test") return Response.json({ result: {
        meta: { err: null, preBalances: [1], postBalances: [50_000_001], preTokenBalances: [], postTokenBalances: [] },
        transaction: { message: { accountKeys: [TREASURY] } },
      } });
      assert.equal(url, "https://redis.example.test");
      return Response.json({ result: await command(...body) });
    };
    const [first, second] = await Promise.all([
      verifySolPayment(sig, PASS_LAMPORTS, "/api/credits/mint", "pf_live_first"),
      verifySolPayment(sig, PASS_LAMPORTS, "/api/credits/mint", "pf_live_second"),
    ]);
    assert.equal([first, second].filter((r) => r.ok).length, 1);
    assert.equal(await command("GET", "pf:stats:tx_count"), "1");
    assert.equal(await command("GET", "pf:stats:lamports"), "50000000");
    assert.equal(await command("TTL", `pf:tx:${sig}`), -1);
    const key = first.ok ? "pf_live_first" : "pf_live_second";
    assert.equal(await command("GET", `pf:key:${key}`), "25");
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json() { return this; } };
    assert.equal(await requireGate({ headers: { authorization: `Bearer ${key}` }, query: {} }, res, 5_000_000, "/curve"), true);
    assert.equal(await command("GET", `pf:key:${key}`), "24");
    await command("SET", `pf:tx:${sig}`, "old", "EX", 30);
    assert.equal((await verifySolPayment(sig, PASS_LAMPORTS, "/api/credits/mint")).ok, false);
    assert.equal(await command("TTL", `pf:tx:${sig}`), -1);
    await command("SET", "pf:stats:tx_count", "invalid");
    const newSig = "4".repeat(88);
    await assert.rejects(verifySolPayment(newSig, PASS_LAMPORTS, "/api/credits/mint", "pf_live_third"));
    assert.equal(await command("EXISTS", `pf:tx:${newSig}`), 0);
    assert.equal(await command("EXISTS", "pf:key:pf_live_third"), 0);
  } finally {
    global.fetch = originalFetch;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
