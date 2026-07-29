import crypto from "node:crypto";
import { config } from "../config";

function marketSensitiveKey() {
  return crypto.createHash("sha256").update(`xjtlu-market-payout:${config.jwtSecret}`).digest();
}

export function sealMarketSensitive(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", marketSensitiveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openMarketSensitive(value: string) {
  const payload = Buffer.from(value, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", marketSensitiveKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}
