import crypto from "node:crypto";

export function marketCategoryLockKey(slug: string) {
  return crypto
    .createHash("sha256")
    .update(`market-category:${slug.trim().toLowerCase()}`)
    .digest()
    .readBigInt64BE(0);
}

/**
 * Category definitions are referenced by slug instead of a database foreign
 * key. Writers and category deletion therefore share this transaction lock so
 * a listing cannot be created against a category that is being removed.
 */
export async function acquireMarketCategoryLock(tx: any, slug: string) {
  const lockKey = marketCategoryLockKey(slug);
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
}
