import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, requireGate } from "../../lib/paywall";
import { scanActiveCurves } from "../../lib/pump";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireGate(req, res, MICRO_LAMPORTS, "/api/pump/koth-scan"))) return;
  try { return res.status(200).json({ ok: true, data: await scanActiveCurves() }); } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
}
