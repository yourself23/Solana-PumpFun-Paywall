const test = require("node:test");
const assert = require("node:assert/strict");

process.env.UPSTASH_REDIS_REST_URL = " https://redis.example.test ";
process.env.UPSTASH_REDIS_REST_TOKEN = " test-token ";

const { redis } = require("../dist/lib/paywall");
const routes = {
  x402: require("../dist/api/well-known-x402").default,
  glama: require("../dist/api/well-known-glama").default,
  llms: require("../dist/api/llms").default,
  sales: require("../dist/api/sales").default,
  mcp: require("../dist/api/mcp").default,
  curve: require("../dist/api/pump/curve").default,
  rugCheck: require("../dist/api/pump/rug-check").default,
  mint: require("../dist/api/credits/mint").default,
};

function response() {
  return {
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

test("compiled routes return expected statuses without payment", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, "https://redis.example.test");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    const [command] = JSON.parse(options.body);
    return Response.json({ result: command === "LRANGE" ? [] : null });
  };
  try {
    for (const [name, handler] of Object.entries(routes)) {
      const res = response();
      await handler({ method: name === "mint" ? "POST" : "GET", headers: {}, query: {} }, res);
      assert.equal(res.statusCode, ["curve", "rugCheck", "mint"].includes(name) ? 402 : 200, name);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("Redis HTTP errors and malformed responses are not treated as empty data", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => new Response("unauthorized", { status: 401 });
    await assert.rejects(redis.get("key"), /HTTP 401/);
    global.fetch = async () => Response.json({});
    await assert.rejects(redis.get("key"), /missing a result/);
  } finally {
    global.fetch = originalFetch;
  }
});
