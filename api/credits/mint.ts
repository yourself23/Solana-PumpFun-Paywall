import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PASS_CREDITS, PASS_LAMPORTS, TREASURY, generateApiKey, redis, verifySolPayment } from "../../lib/paywall";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sig = (req.headers["x-payment-signature"] as string) || (req.body?.signature as string) || (req.query.signature as string) || "";
  if (!sig) return res.status(402).json({ error: "Payment Required for 25-Call Sniper Pass", network: "solana-mainnet", treasury: TREASURY, amount_lamports: PASS_LAMPORTS, credits: PASS_CREDITS });
  const check = await verifySolPayment(sig, PASS_LAMPORTS, "/api/credits/mint");
  if (!check.ok) return res.status(402).json({ error: check.error, treasury: TREASURY, amount_lamports: PASS_LAMPORTS });
  const apiKey = generateApiKey();
  await redis.set(`pf:key:${apiKey}`, PASS_CREDITS, { ex: 7776000 });
  return res.status(200).json({ ok: true, api_key: apiKey, credits: PASS_CREDITS, header_usage: `Authorization: Bearer ${apiKey}` });
}
