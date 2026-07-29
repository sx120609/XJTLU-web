import type { Prisma } from "@prisma/client";

export const SPONSOR_ORDER_LOCK_SCOPE = 1_205_013;

export function sponsorOrderLockKey(orderId: number) {
  return BigInt(SPONSOR_ORDER_LOCK_SCOPE) * 4_294_967_296n + BigInt(orderId);
}

/**
 * Serializes gateway callbacks, user closes, expiry cleanup and manual admin
 * transitions for one sponsorship order.
 */
export async function acquireSponsorOrderLock(
  tx: Prisma.TransactionClient,
  orderId: number,
) {
  const lockKey = sponsorOrderLockKey(orderId);
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}
