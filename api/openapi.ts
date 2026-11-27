import type { VercelRequest, VercelResponse } from "@vercel/node";
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    openapi: "3.1.0",
    info: { title: "Solana PumpFun Paywall", version: "1.0.0", description: "Bonding curve analytics, King of the Hill scans, quote pricing, and rug-check endpoints gated with x402 v2 Solana USDC/SOL payments.", contact: { name: "Willstone Nexus Systems", email: "timothyhuff25@gmail.com" }, "x-guidance": "Pay per call via x402 v2 using Solana Mainnet USDC or SOL to treasury 5Y7aEmYpCyMJanR9qjCUYf59voi6EsJrkjsJB2cNMsW." },
    tags: [{ name: "solana" }, { name: "defi" }, { name: "market-data" }],
    paths: {
      "/api/sales": { get: { summary: "Discovery, pricing, and treasury configuration (Free)", responses: { "200": { description: "OK" } } } },
      "/api/pump/koth-scan": { get: { summary: "Scan active Pump.fun curves approaching King of the Hill ($0.50 USDC / 0.005 SOL)", parameters: [{ name: "limit", in: "query", required: true, description: "Max results", example: 10, schema: { type: "integer", default: 10 } }], responses: { "402": { description: "Payment Required" } } } },
      "/api/pump/curve": { get: { summary: "Decode live Pump.fun bonding curve PDA reserves ($0.50 USDC / 0.005 SOL)", parameters: [{ name: "mint", in: "query", required: true, description: "Pump.fun token mint address", example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", schema: { type: "string" } }], responses: { "402": { description: "Payment Required" } } } },
      "/api/pump/rug-check": { get: { summary: "Audit top-10 holder concentration & sniper bundles ($0.50 USDC / 0.005 SOL)", parameters: [{ name: "mint", in: "query", required: true, description: "Pump.fun token mint address", example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", schema: { type: "string" } }], responses: { "402": { description: "Payment Required" } } } },
      "/api/pump/quote": { get: { summary: "Compute constant-product Pump.fun buy/sell quote ($0.50 USDC / 0.005 SOL)", parameters: [{ name: "mint", in: "query", required: true, description: "Pump.fun token mint address", example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", schema: { type: "string" } }], responses: { "402": { description: "Payment Required" } } } },
      "/api/credits/mint": { post: { summary: "Mint 25 Sniper Pass credits ($5.00 USDC / 0.05 SOL)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { payer: { type: "string" } } } } } }, responses: { "402": { description: "Payment Required" } } } }
    }
  });
}
