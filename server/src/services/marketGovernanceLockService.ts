export const MARKET_GOVERNANCE_LOCK_SCOPES = {
  reportItem: 1_205_021,
  reportWanted: 1_205_022,
  reportUser: 1_205_023,
  reportOrder: 1_205_024,
  reportRecord: 1_205_025,
  violation: 1_205_026,
} as const;

export type MarketGovernanceLockScope = keyof typeof MARKET_GOVERNANCE_LOCK_SCOPES;

export function marketGovernanceLockKey(
  scope: MarketGovernanceLockScope,
  id: number,
) {
  return BigInt(MARKET_GOVERNANCE_LOCK_SCOPES[scope]) * 4_294_967_296n + BigInt(id);
}

/**
 * Serializes low-volume governance decisions by their stable target. Report
 * creation locks the reported object, while report handling and appeals lock
 * the state record itself.
 */
export async function acquireMarketGovernanceLock(
  tx: any,
  scope: MarketGovernanceLockScope,
  id: number,
) {
  const lockKey = marketGovernanceLockKey(scope, id);
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
}
