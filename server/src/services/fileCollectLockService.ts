import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const FILE_COLLECT_TASK_LOCK_SCOPE = 1_205_060;
export const FILE_COLLECT_IDENTITY_LOCK_SCOPE = 1_205_061;
export const FILE_COLLECT_UPLOAD_STALE_MS = 6 * 60 * 60 * 1000;

function scopedLockKey(scope: number, value: string | number) {
  const digest = createHash("sha256")
    .update(String(value))
    .digest();
  const hash = BigInt(digest.readUInt32BE(0));
  return BigInt(scope) * 4_294_967_296n + hash;
}

export function fileCollectTaskLockKey(taskId: number) {
  return scopedLockKey(FILE_COLLECT_TASK_LOCK_SCOPE, taskId);
}

export function fileCollectIdentityLockKey(
  taskId: number,
  identity: string,
) {
  return scopedLockKey(
    FILE_COLLECT_IDENTITY_LOCK_SCOPE,
    `${taskId}:${identity || "<anonymous>"}`,
  );
}

export async function acquireFileCollectTaskLock(
  tx: Prisma.TransactionClient,
  taskId: number,
) {
  const lockKey = fileCollectTaskLockKey(taskId);
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}

export async function acquireFileCollectSubmissionLock(
  tx: Prisma.TransactionClient,
  taskId: number,
  identity: string,
) {
  await acquireFileCollectTaskLock(tx, taskId);
  const lockKey = fileCollectIdentityLockKey(taskId, identity);
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}
