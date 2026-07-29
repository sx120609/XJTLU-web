export const MARKET_ORDER_LOCK_SCOPE = 1_205_005;

export function marketOrderLockKey(orderId: number) {
  return BigInt(MARKET_ORDER_LOCK_SCOPE) * 4_294_967_296n + BigInt(orderId);
}

/**
 * Serializes every state transition for one marketplace order. Writers that
 * also change the listing acquire this lock before the item lock so order
 * actions, payment callbacks, refunds and lifecycle cleanup share one order.
 */
export async function acquireMarketOrderLock(tx: any, orderId: number) {
  const lockKey = marketOrderLockKey(orderId);
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
}
