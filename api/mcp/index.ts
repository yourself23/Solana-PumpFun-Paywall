import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MICRO_LAMPORTS, PASS_CREDITS, PASS_LAMPORTS, TREASURY, requireGate } from "../../lib/paywall";
import { computeQuote, fetchBondingCurve, runRugCheck, scanActiveCurves } from "../../lib/pump";
const TOOLS = [
  { name: "pump_bonding_curve", description: "Decode live Pump.fun bonding curve PDA reserves & graduation % (0.005 SOL)", inputSchema: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } },
  { name: "pump_rug_check", description: "Audit top-10 holder concentration & same-slot sniper bundles (0.005 SOL)", inputSchema: { type: "object", properties: { mint: { type: "string" } }, required: ["mint"] } },
  { name: "pump_swap_quote", description: "Compute constant-product Pump.fun buy/sell quote (0.005 SOL)", inputSchema: { type: "object", properties: { mint: { type: "string" }, side: { type: "string", enum: ["buy", "sell"] }, amount: { type: "string" } }, required: ["mint", "side", "amount"] } },
  { name: "pump_koth_scan", description: "Scan active Pump.fun curves approaching King of the Hill (0.005 SOL)", inputSchema: { type: "object", properties: {} } }
];
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return res.status(200).json({ name: "solana-pumpfun-paywall", protocol: "MCP Streamable HTTP JSON-RPC 2.0", treasury: TREASURY, micro_call_lamports: MICRO_LAMPORTS, sniper_pass_lamports: PASS_LAMPORTS, sniper_pass_credits: PASS_CREDITS, tools: TOOLS });
  const { jsonrpc = "2.0", id = null, method, params = {} } = req.body || {};
  if (method === "initialize") return res.status(200).json({ jsonrpc, id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "solana-pumpfun-paywall", version: "1.0.0" }, capabilities: { tools: {} } } });
  if (method === "tools/list") return res.status(200).json({ jsonrpc, id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    if (!(await requireGate(req, res, MICRO_LAMPORTS, `/api/mcp:${params.name || "unknown"}`))) return;
    try {
      const a = params.arguments || {};
      const out = params.name === "pump_bonding_curve" ? await fetchBondingCurve(String(a.mint || "")) : params.name === "pump_rug_check" ? await runRugCheck(String(a.mint || "")) : params.name === "pump_swap_quote" ? await computeQuote(String(a.mint || ""), a.side, BigInt(String(a.amount || "0"))) : params.name === "pump_koth_scan" ? await scanActiveCurves() : null;
      if (!out) return res.status(200).json({ jsonrpc, id, error: { code: -32601, message: "Unknown tool" } });
      return res.status(200).json({ jsonrpc, id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] } });
    } catch (e) { return res.status(200).json({ jsonrpc, id, error: { code: -32000, message: String(e) } }); }
  }
  return res.status(200).json({ jsonrpc, id, error: { code: -32601, message: "Unsupported method" } });
}
