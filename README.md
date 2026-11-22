# Solana-PumpFun-Paywall

[![Glama MCP](https://glama.ai)](https://glama.ai)

**SOL and USDC x402** and **Remote MCP (Streamable HTTP JSON-RPC 2.0)** gateway for **Pump.fun** bonding curve telemetry, rug/bundle audits, swap quotes, and KOTH scanning on Solana Mainnet.
- **Treasury:** `2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2`
- **Micro-Calls (`0.005 SOL`):** `/api/pump/curve`, `/api/pump/rug-check`, `/api/pump/quote`, `/api/pump/koth-scan`, `/api/mcp`
- **25-Call Sniper Pass (`0.05 SOL`):** `POST /api/credits/mint`
- USDC prices are 0.50 USDC per call and 5 USDC per pass. Send a confirmed transaction signature or a base64-encoded JSON payload containing `payload.transaction` in `X-PAYMENT` or `X-PAYMENT-SIGNATURE`. Token payments must credit an account owned by the treasury wallet.
- Payment signatures are recorded permanently to prevent replay. A signed transaction may take a few seconds to confirm; if confirmation is delayed, the 402 response includes `payment_signature` for retrying without rebroadcasting.

## Deployment

Configure `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SOLANA_RPC_URL`, `RESEND_API_KEY`, `TREASURY_WALLET`, and `ALERT_EMAIL` in the Vercel project's production environment. The sales endpoint and payment verification require the Upstash credentials.

Run `npm install`, `npx tsc --noEmit`, and `npm test` locally. The tests mock RPC and Redis; they do not prove that production services are configured or reachable.
To also run the isolated Redis integration test, set `REDIS_TEST_SERVER` and `REDIS_TEST_CLI` to the paths of local Redis server and CLI binaries.

The `main` branch deploys to the `solana-pumpfun-paywall` project in the `willstone-nexus-systems` team. Configure the repository Actions secret `VERCEL_TOKEN` with access to that project.
