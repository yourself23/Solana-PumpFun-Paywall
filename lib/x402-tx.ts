import { solRpc } from "./paywall";

const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export async function resolvePaymentSig(rawHeader: string): Promise<string> {
  const raw = rawHeader.trim();
  if (!raw) return "";
  if (signaturePattern.test(raw)) return raw;

  let obj: { payload?: { signature?: unknown; transaction?: unknown }; signature?: unknown; txHash?: unknown; transaction?: unknown };
  try {
    obj = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return "";
  }
  if (!obj || typeof obj !== "object") return "";
  const sig = obj.payload?.signature || obj.signature || obj.txHash;
  if (typeof sig === "string" && signaturePattern.test(sig.trim())) return sig.trim();
  const transaction = obj.payload?.transaction || obj.transaction;
  if (typeof transaction !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(transaction)) return "";
  const bytes = Buffer.from(transaction, "base64");
  if (bytes.length === 0 || bytes.length > 1232 || bytes.toString("base64") !== transaction) return "";
  const result = await solRpc("sendTransaction", [transaction, { encoding: "base64", skipPreflight: true, preflightCommitment: "confirmed" }]);
  if (typeof result !== "string" || !signaturePattern.test(result)) throw new Error("Invalid signature returned by sendTransaction");
  return result;
}
