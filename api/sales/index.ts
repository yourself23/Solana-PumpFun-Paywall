import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, PASS_CREDITS, PASS_LAMPORTS, TREASURY, redis } from "../../lib/paywall.js";
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const [lamports, txCount, recentRaw] = await Promise.all([redis.get<number>("pf:stats:lamports"), redis.get<number>("pf:stats:tx_count"), redis.lrange<string>("pf:stats:recent", 0, 9)]);
  return res.status(200).json({ service: "Solana-PumpFun-Paywall", network: "solana-mainnet", treasury: TREASURY, pricing: { micro_call_lamports: MICRO_LAMPORTS, sniper_pass_lamports: PASS_LAMPORTS, sniper_pass_credits: PASS_CREDITS }, stats: { total_settled_lamports: Number(lamports || 0), settled_transactions: Number(txCount || 0) }, recent_settlements: (recentRaw || []).map((x) => (typeof x === "string" ? JSON.parse(x) : x)) });
}
