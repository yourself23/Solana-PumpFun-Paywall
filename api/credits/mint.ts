import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PASS_CREDITS, PASS_LAMPORTS, TREASURY, generateApiKey, requestPaymentSignature, send402, verifySolPayment } from "../../lib/paywall";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sig = await requestPaymentSignature(req);
    if (!sig) return send402(res, PASS_LAMPORTS, "/api/credits/mint", "Payment Required for 25-Call Sniper Pass");
    const apiKey = generateApiKey();
    const check = await verifySolPayment(sig, PASS_LAMPORTS, "/api/credits/mint", apiKey);
    if (!check.ok) return send402(res, PASS_LAMPORTS, "/api/credits/mint", check.error, check.pending ? sig : undefined);
    return res.status(200).json({ ok: true, api_key: apiKey, credits: PASS_CREDITS, treasury: TREASURY, header_usage: `Authorization: Bearer ${apiKey}` });
  } catch (error) {
    console.error("Credit minting failed:", error);
    return res.status(503).json({ error: "Credit minting temporarily unavailable" });
  }
}
