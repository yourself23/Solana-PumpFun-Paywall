import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, requireGate } from "../../lib/paywall.js";
import { runRugCheck } from "../../lib/pump.js";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireGate(req, res, MICRO_LAMPORTS, "/api/pump/rug-check"))) return;
  const mint = String(req.query.mint || req.body?.mint || "").trim();
  if (!mint) return res.status(400).json({ error: "Missing mint" });
  try { return res.status(200).json({ ok: true, data: await runRugCheck(mint) }); } catch (e) { return res.status(400).json({ ok: false, error: String(e) }); }
}
