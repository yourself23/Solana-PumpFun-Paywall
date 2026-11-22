import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

export const TREASURY = (process.env.TREASURY_WALLET || "2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2").trim();
export const RPC_URL = (process.env.SOLANA_RPC_URL || "https://solana.com").trim();
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MICRO_LAMPORTS = 5_000_000;
export const PASS_LAMPORTS = 50_000_000;
export const PASS_CREDITS = 25;

export async function solRpc(method: string, params: unknown[]) {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await res.json() as { result?: any; error?: any };
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}

async function upstash(cmd: (string | number)[]) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await res.json() as { result?: unknown; error?: string };
  if (j.error) throw new Error(j.error);
  return j.result;
}

export const redis = {
  get: async <T = string>(k: string) => (await upstash(["GET", k])) as T | null,
  set: async (k: string, v: string | number, opts?: { nx?: boolean; ex?: number }) => (await upstash(["SET", k, v, ...(opts?.ex ? ["EX", opts.ex] : []), ...(opts?.nx ? ["NX"] : [])])) === "OK",
  del: async (k: string) => upstash(["DEL", k]),
  incr: async (k: string) => Number(await upstash(["INCR", k])),
  decr: async (k: string) => Number(await upstash(["DECR", k])),
  incrby: async (k: string, n: number) => Number(await upstash(["INCRBY", k, n])),
  lpush: async (k: string, v: string) => upstash(["LPUSH", k, v]),
  ltrim: async (k: string, s: number, e: number) => upstash(["LTRIM", k, s, e]),
  lrange: async <T = string>(k: string, s: number, e: number) => ((await upstash(["LRANGE", k, s, e])) || []) as T[]
};
