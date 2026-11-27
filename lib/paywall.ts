import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { resolvePaymentSig } from "./x402-tx";

export const TREASURY = process.env.TREASURY_WALLET?.trim() || "5Y7aEmYpCyMJanR9qjCUYf59voi6EsJrkjsJB2cNMsW";
export const RPC_URL = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MICRO_LAMPORTS = 5_000_000;
export const PASS_LAMPORTS = 50_000_000;
export const PASS_CREDITS = 25;

export async function solRpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!res.ok) throw new Error(`Solana RPC request failed with HTTP ${res.status}`);
  const json = await res.json() as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  if (!("result" in json)) throw new Error("Solana RPC response is missing a result");
  return json.result;
}

async function upstash(cmd: (string | number)[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  if (!url || !token) throw new Error("Upstash Redis REST URL and token must be configured");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  if (!res.ok) throw new Error(`Upstash Redis request failed with HTTP ${res.status}`);
  const json = await res.json() as { result?: unknown; error?: string };
  if (json.error) throw new Error(json.error);
  if (!("result" in json)) throw new Error("Upstash Redis response is missing a result");
  return json.result;
}

export const redis = {
  get: async <T = string>(key: string) => (await upstash(["GET", key])) as T | null,
  lrange: async <T = string>(key: string, start: number, end: number) => {
    const result = await upstash(["LRANGE", key, start, end]);
    if (!Array.isArray(result)) throw new Error("Invalid Redis list response");
    return result as T[];
  },
};

const consumeCreditScript = `
local value = redis.call('GET', KEYS[1])
if not value or tonumber(value) <= 0 then return -1 end
return redis.call('DECR', KEYS[1])
`;

const settleScript = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('PERSIST', KEYS[1])
  return 0
end
for i = 2, 4 do
  local value = redis.call('GET', KEYS[i]) or '0'
  local increment = i == 2 and tonumber(ARGV[2]) or (i == 3 and tonumber(ARGV[3]) or 1)
  if not string.match(value, '^%d+$') or not tonumber(value) or tonumber(value) + increment > 9007199254740991 then
    return redis.error_reply('Invalid settlement counter')
  end
end
redis.call('LRANGE', KEYS[5], 0, 0)
if ARGV[5] ~= '' and redis.call('EXISTS', KEYS[6]) == 1 then
  return redis.error_reply('Credit key already exists')
end
if not redis.call('SET', KEYS[1], ARGV[1], 'NX') then
  redis.call('PERSIST', KEYS[1])
  return 0
end
redis.call('INCRBY', KEYS[2], ARGV[2])
redis.call('INCRBY', KEYS[3], ARGV[3])
redis.call('INCR', KEYS[4])
redis.call('LPUSH', KEYS[5], ARGV[4])
redis.call('LTRIM', KEYS[5], 0, 24)
if ARGV[5] ~= '' then redis.call('SET', KEYS[6], ARGV[6], 'EX', 7776000) end
return 1
`;

type TokenBalance = { accountIndex?: number; mint?: string; owner?: string; uiTokenAmount?: { amount?: string } };
type Transaction = {
  meta?: { err?: unknown; preBalances?: number[]; postBalances?: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] };
  transaction?: { message?: { accountKeys?: (string | { pubkey: string })[] } };
};

function treasuryUsdc(balances: TokenBalance[] | undefined): bigint {
  if (!balances) return 0n;
  return balances.reduce((sum, balance) => {
    if (balance.mint === USDC_MINT && typeof balance.owner !== "string") throw new Error("USDC token balance is missing an owner");
    if (balance.owner !== TREASURY || balance.mint !== USDC_MINT) return sum;
    const amount = balance.uiTokenAmount?.amount;
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) throw new Error("Invalid USDC token balance");
    return sum + BigInt(amount);
  }, 0n);
}

function usdcPrice(minLamports: number): number {
  return minLamports >= PASS_LAMPORTS ? 5_000_000 : 500_000;
}

async function sendAlert(signature: string, lamports: number, usdc: number, route: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim() || "";
  if (!key) return;
  const email = process.env.ALERT_EMAIL?.trim() || "timothyhuff25@gmail.com";
  try {
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `pf-pay-${signature}` }, body: JSON.stringify({ from: "Solana PumpFun Paywall <onboarding@resend.dev>", to: [email], subject: `Payment settled on ${route}`, text: `Sig: ${signature}\nLamports: ${lamports}\nUSDC atomic: ${usdc}\nTreasury: ${TREASURY}\nRoute: ${route}` }) });
    if (!res.ok) console.error(`Payment alert failed: HTTP ${res.status}`);
  } catch (error) {
    console.error("Payment alert failed:", error);
  }
}

export async function verifySolPayment(signature: string, minLamports: number, route: string, apiKey = "") {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return { ok: false, error: "Invalid Solana signature" };
  let tx: Transaction | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    tx = await solRpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]) as Transaction | null;
    if (tx) break;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  if (!tx) return { ok: false, error: "Transaction not yet confirmed; retry using its signature", pending: true };
  if (!tx.meta || tx.meta.err !== null) return { ok: false, error: "Transaction failed or has invalid metadata" };
  const keys = tx.transaction?.message?.accountKeys?.map((key) => typeof key === "string" ? key : key.pubkey) || [];
  const idx = keys.indexOf(TREASURY);
  const before = idx < 0 ? 0 : tx.meta.preBalances?.[idx];
  const after = idx < 0 ? 0 : tx.meta.postBalances?.[idx];
  if (idx >= 0 && (!Number.isSafeInteger(before) || !Number.isSafeInteger(after))) throw new Error("Invalid treasury SOL balance");
  const lamports = Math.max(0, (after ?? 0) - (before ?? 0));
  if (tx.meta.postTokenBalances?.length && !Array.isArray(tx.meta.preTokenBalances)) throw new Error("Missing pre-transaction token balances");
  if (tx.meta.preTokenBalances?.length && !Array.isArray(tx.meta.postTokenBalances)) throw new Error("Missing post-transaction token balances");
  const usdcDelta = treasuryUsdc(tx.meta.postTokenBalances) - treasuryUsdc(tx.meta.preTokenBalances);
  const usdc = usdcDelta > 0n ? usdcDelta : 0n;
  if (lamports < minLamports && usdc < BigInt(usdcPrice(minLamports))) return { ok: false, error: "Insufficient treasury payment" };
  if (usdc > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("USDC payment exceeds supported range");
  const usdcNumber = Number(usdc);
  const recent = JSON.stringify({ signature, lamports, usdc_atomic: usdcNumber, route, ts: Date.now() });
  const settled = await upstash(["EVAL", settleScript, 6, `pf:tx:${signature}`, "pf:stats:lamports", "pf:stats:usdc_atomic", "pf:stats:tx_count", "pf:stats:recent", apiKey ? `pf:key:${apiKey}` : "pf:unused", route, lamports, usdcNumber, recent, apiKey, PASS_CREDITS]);
  if (settled !== 1) {
    if (settled === 0) return { ok: false, error: "Signature already redeemed" };
    throw new Error("Invalid Redis settlement response");
  }
  await sendAlert(signature, lamports, usdcNumber, route);
  return { ok: true, lamports, usdc_atomic: usdcNumber };
}

export async function requestPaymentSignature(req: VercelRequest): Promise<string> {
  const raw = req.headers["x-payment-signature"] || req.headers["x-payment"] || req.headers["payment-signature"] || req.query.signature || req.body?.signature || "";
  return typeof raw === "string" ? resolvePaymentSig(raw) : "";
}

export function send402(res: VercelResponse, minLamports: number, route: string, msg = "Payment Required (x402 Native SOL or USDC)", pendingSignature?: string) {
  const minUsdc = usdcPrice(minLamports);
  const accept = (asset: string, amount: string) => ({ scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset, amount, maxAmountRequired: amount, payTo: TREASURY, maxTimeoutSeconds: 60, extra: {} });
  const challenge = { x402Version: 2, error: msg, resource: { url: route, mimeType: "application/json" }, accepts: [accept("So11111111111111111111111111111111111111112", String(minLamports)), accept(USDC_MINT, String(minUsdc))], treasury: TREASURY, amount_lamports: minLamports, amount_usdc_atomic: minUsdc, ...(pendingSignature ? { payment_signature: pendingSignature } : {}) };
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(challenge)).toString("base64"));
  return res.status(402).json(challenge);
}

export async function requireGate(req: VercelRequest, res: VercelResponse, minLamports: number, route: string): Promise<boolean> {
  try {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer pf_live_")) {
      const token = auth.slice(7).trim();
      const remaining = await upstash(["EVAL", consumeCreditScript, 1, `pf:key:${token}`]);
      if (typeof remaining !== "number") throw new Error("Invalid Redis credit response");
      if (remaining >= 0) { res.setHeader("X-Credits-Remaining", String(remaining)); return true; }
      send402(res, minLamports, route, "Sniper pass depleted or invalid");
      return false;
    }
    const sig = await requestPaymentSignature(req);
    if (!sig) { send402(res, minLamports, route); return false; }
    const check = await verifySolPayment(sig, minLamports, route);
    if (!check.ok) { send402(res, minLamports, route, check.error, check.pending ? sig : undefined); return false; }
    return true;
  } catch (error) {
    console.error("Payment verification failed:", error);
    res.status(503).json({ error: "Payment verification temporarily unavailable" });
    return false;
  }
}

export const generateApiKey = () => `pf_live_${crypto.randomBytes(20).toString("hex")}`;
