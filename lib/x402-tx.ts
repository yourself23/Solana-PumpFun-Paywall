import { solRpc } from "./paywall";

export async function resolvePaymentSig(rawHeader: string): Promise<string> {
  if (!rawHeader) return "";
  if (!rawHeader.startsWith("{") && !rawHeader.startsWith("eyJ")) return rawHeader.trim();
  try {
    const obj = JSON.parse(rawHeader.startsWith("eyJ") ? Buffer.from(rawHeader, "base64").toString("utf8") : rawHeader);
    const sig = obj?.payload?.signature || obj?.signature || obj?.txHash;
    if (sig && sig.length >= 64) return sig;
    const rawTx = obj?.payload?.transaction || obj?.transaction;
    if (rawTx && rawTx.length > 80) {
      return await solRpc("sendTransaction", [rawTx, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }]);
    }
  } catch {}
  return "";
}
