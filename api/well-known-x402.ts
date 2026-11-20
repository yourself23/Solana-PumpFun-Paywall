import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, PASS_CREDITS, PASS_LAMPORTS, TREASURY } from "../lib/paywall.js";
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ version: "1.0", name: "Solana-PumpFun-Paywall", network: "solana-mainnet", currency: "SOL", mint: "So11111111111111111111111111111111111111112", treasury: TREASURY, endpoints: [{ path: "/api/pump/curve", amount_lamports: MICRO_LAMPORTS }, { path: "/api/pump/rug-check", amount_lamports: MICRO_LAMPORTS }, { path: "/api/pump/quote", amount_lamports: MICRO_LAMPORTS }, { path: "/api/pump/koth-scan", amount_lamports: MICRO_LAMPORTS }, { path: "/api/credits/mint", amount_lamports: PASS_LAMPORTS, credits: PASS_CREDITS }, { path: "/api/mcp", amount_lamports: MICRO_LAMPORTS }] });
}
