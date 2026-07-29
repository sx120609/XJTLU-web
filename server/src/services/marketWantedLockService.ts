export const MARKET_WANTED_LOCK_SCOPE = 1_205_006;

export function marketWantedLockKey(wantedPostId: number) {
  return BigInt(MARKET_WANTED_LOCK_SCOPE) * 4_294_967_296n + BigInt(wantedPostId);
}

/**
 * Every transaction that changes a wanted post's response/matching state uses
 * the same lock key. This prevents two app nodes from accepting different
 * responses, or a lifecycle action from racing an acceptance.
 */
export async function acquireMarketWantedLock(tx: any, wantedPostId: number) {
  const lockKey = marketWantedLockKey(wantedPostId);
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
}
