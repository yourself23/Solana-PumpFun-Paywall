# Solana-PumpFun-Paywall

[![Glama MCP](https://glama.ai)](https://glama.ai)

Production **Native SOL x402** and **Remote MCP (Streamable HTTP JSON-RPC 2.0)** gateway for **Pump.fun** bonding curve telemetry, rug/bundle audits, swap quotes, and KOTH scanning on Solana Mainnet.
- **Treasury:** `2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2`
- **Micro-Calls (`0.005 SOL`):** `/api/pump/curve`, `/api/pump/rug-check`, `/api/pump/quote`, `/api/pump/koth-scan`, `/api/mcp`
- **25-Call Sniper Pass (`0.05 SOL`):** `POST /api/credits/mint`

## Deployment

Configure `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SOLANA_RPC_URL`, `RESEND_API_KEY`, `TREASURY_WALLET`, and `ALERT_EMAIL` in the Vercel project's production environment. The sales endpoint and payment verification require the Upstash credentials.

The `main` branch deploys to the `solana-pumpfun-paywall` project in the `willstone-nexus-systems` team. Configure the repository Actions secret `VERCEL_TOKEN` with access to that project.
