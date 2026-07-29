import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const GRADE_CHECK_LOCK_SCOPE = 1_205_080;

export function gradeCheckLockKey(tableId: number) {
  const digest = createHash("sha256")
    .update(String(tableId))
    .digest();
  return BigInt(GRADE_CHECK_LOCK_SCOPE) * 4_294_967_296n
    + BigInt(digest.readUInt32BE(0));
}

export async function acquireGradeCheckLock(
  tx: Prisma.TransactionClient,
  tableId: number,
) {
  const lockKey = gradeCheckLockKey(tableId);
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}
