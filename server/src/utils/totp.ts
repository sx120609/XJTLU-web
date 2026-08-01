import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string) {
  const normalized = value.replace(/[=\s-]/g, "").toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error("Invalid TOTP secret");
  let bits = "";
  for (const char of normalized) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [] as number[];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeFor(secret: Buffer, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (
    ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3]
  ) % 1_000_000;
  return String(value).padStart(6, "0");
}

export function verifyTotp(secretValue: string, input: string, now = Date.now()) {
  const code = String(input || "").trim();
  if (!/^\d{6}$/.test(code)) return false;
  let secret: Buffer;
  try { secret = decodeBase32(secretValue); } catch { return false; }
  const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) => {
    const expected = codeFor(secret, counter + offset);
    const left = Buffer.from(expected);
    const right = Buffer.from(code);
    return crypto.timingSafeEqual(left, right);
  });
}

export function generateTotp(secretValue: string, now = Date.now()) {
  const secret = decodeBase32(secretValue);
  return codeFor(secret, Math.floor(now / 30_000));
}

export function normalizeTotpSecret(value: string) {
  const normalized = String(value || "").replace(/[=\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{16,128}$/.test(normalized)) throw new Error("TOTP secret must be base32 and 16-128 characters");
  return normalized;
}
