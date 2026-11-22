import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TREASURY } from "../lib/paywall";
export default function handler(_req: VercelRequest, res: VercelResponse) { res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.status(200).send(`# Solana-PumpFun-Paywall\nTreasury: ${TREASURY}\nMicro-call: 0.005 SOL (5000000 lamports) via x-payment-signature\nSniper Pass: 0.05 SOL (50000000 lamports) at POST /api/credits/mint for 25 calls\nMCP: POST /api/mcp\n`); }
