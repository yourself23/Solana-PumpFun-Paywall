import crypto from "node:crypto";
import { solRpc } from "./paywall";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PUMP_PROG = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const INIT_REAL_TOKENS = 793_100_000_000_000n;

function b58Decode(s: string): Buffer {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("Invalid base58"); n = n * 58n + BigInt(i); }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c === "1") bytes.unshift(0); else break; }
  return Buffer.from(bytes);
}

function b58Encode(buf: Buffer): string {
  let n = 0n;
  for (const b of buf) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}

function isOnCurve(bytes: Buffer): boolean {
  const P = (1n << 255n) - 19n;
  const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
  let y = 0n;
  for (let i = 0; i < 32; i++) y |= BigInt(bytes[i] & (i === 31 ? 0x7f : 0xff)) << BigInt(8 * i);
  if (y >= P) return false;
  const y2 = (y * y) % P, u = (y2 - 1n + P) % P, v = (D * y2 + 1n) % P;
  const modPow = (b: bigint, e: bigint) => { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; };
  const x = (u * modPow(v, (P - 5n) / 8n)) % P;
  const check = (v * x * x) % P;
  if (check === u || check === (P - u) % P) return true;
  const x2 = (x * modPow(2n, (P - 1n) / 4n)) % P;
  const check2 = (v * x2 * x2) % P;
  return check2 === u || check2 === (P - u) % P;
}

function deriveCurvePda(mintStr: string): string {
  const mint = b58Decode(mintStr), prog = b58Decode(PUMP_PROG);
  if (mint.length !== 32) throw new Error("Invalid mint length");
  for (let bump = 255; bump >= 0; bump--) {
    const hash = crypto.createHash("sha256").update(Buffer.concat([Buffer.from("bonding-curve"), mint, Buffer.from([bump]), prog, Buffer.from("ProgramDerivedAddress")])).digest();
    if (!isOnCurve(hash)) return b58Encode(hash);
  }
  throw new Error("Unable to derive bonding curve PDA");
}

export async function fetchBondingCurve(mintStr: string) {
  const pda = deriveCurvePda(mintStr);
  const info = await solRpc("getAccountInfo", [pda, { encoding: "base64" }]);
  const b64 = info?.value?.data?.at(0);
  if (!b64) throw new Error("Bonding curve PDA not found");
  const d = Buffer.from(b64, "base64");
  if (d.length < 49) throw new Error("Invalid bonding curve account data");
  const vTok = d.readBigUInt64LE(8), vSol = d.readBigUInt64LE(16), rTok = d.readBigUInt64LE(24), rSol = d.readBigUInt64LE(32), supply = d.readBigUInt64LE(40);
  const complete = d.readUInt8(48) === 1;
  const sold = INIT_REAL_TOKENS > rTok ? INIT_REAL_TOKENS - rTok : 0n;
  const progressPct = complete ? 100 : Math.min(100, Number((sold * 10000n) / INIT_REAL_TOKENS) / 100);
  const spotPriceSol = vTok > 0n ? (Number(vSol) / 1e9) / (Number(vTok) / 1e6) : 0;
  const remainingSolToGraduate = complete || rSol >= 85_000_000_000n ? 0 : Number(85_000_000_000n - rSol) / 1e9;
  return { mint: mintStr, bondingCurvePda: pda, virtualTokenReserves: vTok.toString(), virtualSolReserves: vSol.toString(), realTokenReserves: rTok.toString(), realSolReserves: rSol.toString(), complete, progressPct: Number(progressPct.toFixed(2)), spotPriceSol: Number(spotPriceSol.toExponential(6)), marketCapSol: Number((spotPriceSol * (Number(supply) / 1e6)).toFixed(4)), remainingSolToGraduate: Number(remainingSolToGraduate.toFixed(4)) };
}

export async function runRugCheck(mintStr: string) {
  const [curve, largest, sigs] = await Promise.all([fetchBondingCurve(mintStr), solRpc("getTokenLargestAccounts", [mintStr]), solRpc("getSignaturesForAddress", [mintStr, { limit: 30 }])]);
  const holders = (largest?.value || []).map((a: any) => ({ address: a.address, amount: a.amount, pct: Number((BigInt(a.amount) * 10000n) / 1_000_000_000_000_000n) / 100 }));
  const ext = holders.slice(1);
  const top10ExternalPct = Number(ext.slice(0, 10).reduce((s: number, h: any) => s + h.pct, 0).toFixed(2));
  const largestExternalPct = ext?.pct || 0;
  const slots = new Map<number, number>();
  for (const s of sigs || []) slots.set(s.slot, (slots.get(s.slot) || 0) + 1);
  const maxSameSlotTxs = Math.max(0, ...slots.values());
  const bundledLaunchSuspected = maxSameSlotTxs >= 4;
  const riskScore = (top10ExternalPct > 35 ? 40 : top10ExternalPct > 20 ? 20 : 0) + (largestExternalPct > 10 ? 25 : 0) + (bundledLaunchSuspected ? 25 : 0);
  return { mint: mintStr, complete: curve.complete, progressPct: curve.progressPct, top10ExternalHolderPct: top10ExternalPct, largestExternalHolderPct: largestExternalPct, maxSameSlotTxs, bundledLaunchSuspected, riskScore, riskLevel: riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "MEDIUM" : "LOW", topHolders: holders.slice(0, 10) };
}

export async function computeQuote(mintStr: string, side: "buy" | "sell", amountRaw: bigint) {
  const curve = await fetchBondingCurve(mintStr);
  if (curve.complete) throw new Error("Curve already graduated");
  const vSol = BigInt(curve.virtualSolReserves), vTok = BigInt(curve.virtualTokenReserves), k = vSol * vTok;
  if (side === "buy") {
    const fee = (amountRaw * 100n) / 10_000n, netSol = amountRaw - fee, tokensOut = vTok - (k / (vSol + netSol) + 1n);
    return { mint: mintStr, side, inputLamports: amountRaw.toString(), protocolFeeLamports: fee.toString(), estimatedTokensOut: tokensOut.toString(), progressPct: curve.progressPct };
  }
  const grossSol = vSol - k / (vTok + amountRaw), fee = (grossSol * 100n) / 10_000n;
  return { mint: mintStr, side, inputTokens: amountRaw.toString(), protocolFeeLamports: fee.toString(), estimatedLamportsOut: (grossSol - fee).toString(), progressPct: curve.progressPct };
}

export async function scanActiveCurves() {
  const sigs = await solRpc("getSignaturesForAddress", [PUMP_PROG, { limit: 12 }]);
  const seen = new Set<string>(), curves = [];
  for (const s of (sigs || []).slice(0, 6)) {
    if (s.err) continue;
    const tx = await solRpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    for (const b of tx?.meta?.postTokenBalances || []) {
      if (b.mint?.endsWith("pump") && !seen.has(b.mint)) {
        seen.add(b.mint);
        try { const c = await fetchBondingCurve(b.mint); if (!c.complete) curves.push(c); } catch {}
      }
      if (curves.length >= 5) break;
    }
    if (curves.length >= 5) break;
  }
  curves.sort((a, b) => b.progressPct - a.progressPct);
  return { scannedSignatures: (sigs || []).length, activeCurves: curves };
}
