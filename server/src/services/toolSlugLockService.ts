import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const TOOL_SLUG_LOCK_SCOPE = 1_205_090;

export type ToolSlugDomain =
  | "questionnaire"
  | "grade-check"
  | "file-collect";

export function toolSlugLockKey(domain: ToolSlugDomain, base: string) {
  const digest = createHash("sha256")
    .update(`${domain}:${base}`)
    .digest();
  return BigInt(TOOL_SLUG_LOCK_SCOPE) * 4_294_967_296n
    + BigInt(digest.readUInt32BE(0));
}

export async function acquireToolSlugLock(
  tx: Prisma.TransactionClient,
  domain: ToolSlugDomain,
  base: string,
) {
  const lockKey = toolSlugLockKey(domain, base);
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}
