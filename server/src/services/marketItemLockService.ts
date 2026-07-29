export const MARKET_ITEM_LOCK_SCOPE = 1_205_007;

export function marketItemLockKey(itemId: number) {
  return BigInt(MARKET_ITEM_LOCK_SCOPE) * 4_294_967_296n + BigInt(itemId);
}

/**
 * Serializes all state-changing trade decisions for one marketplace item.
 * Conditional updates remain in place as a second guard against writers that
 * intentionally bypass the application service (for example moderation).
 */
export async function acquireMarketItemLock(tx: any, itemId: number) {
  const lockKey = marketItemLockKey(itemId);
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
}
