import { PublicKey } from "@solana/web3.js";
import { connection } from "./paywall.js";
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const INIT_REAL_TOKENS = 793_100_000_000_000n;
export async function fetchBondingCurve(mintStr: string) {
  const mint = new PublicKey(mintStr);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM_ID);
  const info = await connection.getAccountInfo(pda);
  if (!info || info.data.length < 49) throw new Error("Bonding curve PDA not found");
  const d = info.data;
  const vTok = d.readBigUInt64LE(8), vSol = d.readBigUInt64LE(16), rTok = d.readBigUInt64LE(24), rSol = d.readBigUInt64LE(32), supply = d.readBigUInt64LE(40);
  const complete = d.readUInt8(48) === 1;
  const sold = INIT_REAL_TOKENS > rTok ? INIT_REAL_TOKENS - rTok : 0n;
  const progressPct = complete ? 100 : Math.min(100, Number((sold * 10000n) / INIT_REAL_TOKENS) / 100);
  const spotPriceSol = vTok > 0n ? (Number(vSol) / 1e9) / (Number(vTok) / 1e6) : 0;
  const remainingSolToGraduate = complete || rSol >= 85_000_000_000n ? 0 : Number(85_000_000_000n - rSol) / 1e9;
  return { mint: mint.toBase58(), bondingCurvePda: pda.toBase58(), virtualTokenReserves: vTok.toString(), virtualSolReserves: vSol.toString(), realTokenReserves: rTok.toString(), realSolReserves: rSol.toString(), complete, progressPct: Number(progressPct.toFixed(2)), spotPriceSol: Number(spotPriceSol.toExponential(6)), marketCapSol: Number((spotPriceSol * (Number(supply) / 1e6)).toFixed(4)), remainingSolToGraduate: Number(remainingSolToGraduate.toFixed(4)) };
}
export async function runRugCheck(mintStr: string) {
  const mint = new PublicKey(mintStr);
  const [curve, largest, sigs] = await Promise.all([fetchBondingCurve(mintStr), connection.getTokenLargestAccounts(mint), connection.getSignaturesForAddress(mint, { limit: 30 })]);
  const holders = largest.value.map((a) => ({ address: a.address.toBase58(), amount: a.amount, pct: Number((BigInt(a.amount) * 10000n) / 1_000_000_000_000_000n) / 100 }));
  const ext = holders.slice(1);
  const top10ExternalPct = Number(ext.slice(0, 10).reduce((s, h) => s + h.pct, 0).toFixed(2));
  const largestExternalPct = ext[0]?.pct || 0;
  const slots = new Map<number, number>();
  for (const s of sigs) slots.set(s.slot, (slots.get(s.slot) || 0) + 1);
  const maxSameSlotTxs = Math.max(0, ...slots.values());
  const bundledLaunchSuspected = maxSameSlotTxs >= 4;
  let riskScore = (top10ExternalPct > 35 ? 40 : top10ExternalPct > 20 ? 20 : 0) + (largestExternalPct > 10 ? 25 : 0) + (bundledLaunchSuspected ? 25 : 0);
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
  const sigs = await connection.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit: 12 });
  const seen = new Set<string>(), curves = [];
  for (const s of sigs.slice(0, 6)) {
    if (s.err) continue;
    const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
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
  return { scannedSignatures: sigs.length, activeCurves: curves };
}
