import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, requireGate } from "../../lib/paywall.js";
import { computeQuote } from "../../lib/pump.js";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireGate(req, res, MICRO_LAMPORTS, "/api/pump/quote"))) return;
  const mint = String(req.query.mint || req.body?.mint || "").trim();
  const side = String(req.query.side || req.body?.side || "buy").toLowerCase();
  const amount = String(req.query.amount || req.body?.amount || "").trim();
  if (!mint || !amount || (side !== "buy" && side !== "sell")) return res.status(400).json({ error: "Required: mint, side, amount" });
  try { return res.status(200).json({ ok: true, data: await computeQuote(mint, side, BigInt(amount)) }); } catch (e) { return res.status(400).json({ ok: false, error: String(e) }); }
}
