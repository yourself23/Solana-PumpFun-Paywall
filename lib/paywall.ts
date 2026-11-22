import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Connection } from "@solana/web3.js";
import crypto from "node:crypto";

export const TREASURY = (process.env.TREASURY_WALLET || "2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2").trim();
export const RPC_URL = (process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com").trim();
export const MICRO_LAMPORTS = 5_000_000;
export const PASS_LAMPORTS = 50_000_000;
export const PASS_CREDITS = 25;
export const connection = new Connection(RPC_URL, "confirmed");

async function upstash(cmd: (string | number)[]) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const json = await res.json() as { result?: unknown; error?: string };
  if (json.error) throw new Error(json.error);
  return json.result;
}

export const redis = {
  get: async <T = string>(k: string) => (await upstash(["GET", k])) as T | null,
  set: async (k: string, v: string | number, opts?: { nx?: boolean; ex?: number }) => (await upstash(["SET", k, v, ...(opts?.ex ? ["EX", opts.ex] : []), ...(opts?.nx ? ["NX"] : [])])) === "OK",
  del: async (k: string) => upstash(["DEL", k]),
  incr: async (k: string) => Number(await upstash(["INCR", k])),
  decr: async (k: string) => Number(await upstash(["DECR", k])),
  incrby: async (k: string, n: number) => Number(await upstash(["INCRBY", k, n])),
  lpush: async (k: string, v: string) => upstash(["LPUSH", k, v]),
  ltrim: async (k: string, s: number, e: number) => upstash(["LTRIM", k, s, e]),
  lrange: async <T = string>(k: string, s: number, e: number) => ((await upstash(["LRANGE", k, s, e])) || []) as T[]
};

async function sendAlert(signature: string, lamports: number, route: string) {
  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key) return;
  fetch("https://resend.com", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `pf-pay-${signature}` }, body: JSON.stringify({ from: "Solana PumpFun Paywall <onboarding@resend.dev>", to: [(process.env.ALERT_EMAIL || "timothyhuff25@gmail.com").trim()], subject: `Settled ${(lamports / 1e9).toFixed(4)} SOL on ${route}`, text: `Sig: ${signature}\nLamports: ${lamports}\nTreasury: ${TREASURY}\nRoute: ${route}` }) }).catch(() => {});
}

export async function verifySolPayment(signature: string, minLamports: number, route: string) {
  if (!signature || signature.length < 64) return { ok: false, error: "Invalid Solana signature" };
  const replayKey = `pf:tx:${signature}`;
  if (!(await redis.set(replayKey, route, { nx: true, ex: 2592000 }))) return { ok: false, error: "Signature already redeemed" };
  try {
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx || tx.meta?.err) { await redis.del(replayKey); return { ok: false, error: "Tx not found or failed on Mainnet" }; }
    const idx = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()).indexOf(TREASURY);
    if (idx === -1 || !tx.meta) { await redis.del(replayKey); return { ok: false, error: "Treasury not credited" }; }
    const received = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
    if (received < minLamports) { await redis.del(replayKey); return { ok: false, error: `Received ${received}, need ${minLamports}` }; }
    await redis.incrby("pf:stats:lamports", received);
    await redis.incr("pf:stats:tx_count");
    await redis.lpush("pf:stats:recent", JSON.stringify({ signature, lamports: received, route, ts: Date.now() }));
    await redis.ltrim("pf:stats:recent", 0, 24);
    await sendAlert(signature, received, route);
    return { ok: true, lamports: received };
  } catch (err) { await redis.del(replayKey); return { ok: false, error: String(err) }; }
}

export async function requireGate(req: VercelRequest, res: VercelResponse, minLamports: number, route: string): Promise<boolean> {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer pf_live_")) {
    const token = auth.slice(7).trim();
    const rem = await redis.decr(`pf:key:${token}`);
    if (rem >= 0) { res.setHeader("X-Credits-Remaining", String(rem)); return true; }
    await redis.incr(`pf:key:${token}`);
    res.status(402).json({ error: "Sniper pass depleted or invalid", treasury: TREASURY, pass_lamports: PASS_LAMPORTS, credits: PASS_CREDITS });
    return false;
  }
  const sig = (req.headers["x-payment-signature"] as string) || (req.query.signature as string) || "";
  if (!sig) {
    res.status(402).json({ error: "Payment Required (x402 Native SOL)", network: "solana-mainnet", asset: "SOL", mint: "So11111111111111111111111111111111111111112", treasury: TREASURY, amount_lamports: minLamports, pass_option: { endpoint: "/api/credits/mint", amount_lamports: PASS_LAMPORTS, credits: PASS_CREDITS } });
    return false;
  }
  const check = await verifySolPayment(sig, minLamports, route);
  if (!check.ok) { res.status(402).json({ error: check.error, treasury: TREASURY, amount_lamports: minLamports }); return false; }
  return true;
}

export const generateApiKey = () => `pf_live_${crypto.randomBytes(20).toString("hex")}`;
