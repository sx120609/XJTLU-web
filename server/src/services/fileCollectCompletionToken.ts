import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export const FILE_COLLECT_COMPLETION_TOKEN_TTL_MS =
  8 * 60 * 60 * 1000;
const FILE_COLLECT_COMPLETION_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type FileCollectCompletionSubject = {
  id: number;
  taskId: number;
  createdAt: Date;
};

export function signFileCollectCompletionToken(
  submission: FileCollectCompletionSubject,
) {
  const payload = Buffer.from(JSON.stringify({
    id: submission.id,
    taskId: submission.taskId,
    createdAt: submission.createdAt.getTime(),
  })).toString("base64url");
  const signature = createHmac("sha256", config.jwtSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyFileCollectCompletionToken(
  token: string,
  submission: FileCollectCompletionSubject,
) {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) return false;
  const expected = createHmac("sha256", config.jwtSecret)
    .update(payload)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (
    received.length !== expected.length
    || received.toString("base64url") !== signature
    || !timingSafeEqual(received, expected)
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      id?: unknown;
      taskId?: unknown;
      createdAt?: unknown;
    };
    const createdAt = Number(parsed.createdAt);
    const ageMs = Date.now() - createdAt;
    return Number(parsed.id) === submission.id
      && Number(parsed.taskId) === submission.taskId
      && createdAt === submission.createdAt.getTime()
      && ageMs >= -FILE_COLLECT_COMPLETION_CLOCK_SKEW_MS
      && ageMs <= FILE_COLLECT_COMPLETION_TOKEN_TTL_MS;
  } catch {
    return false;
  }
}
