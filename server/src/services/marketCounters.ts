import { prisma } from "../prisma";

const MERCHANT_FAVORITE_LOCK_SCOPE = 1_205_002;

async function lockedToggle<T>(scope: number, targetId: number, operation: (tx: any) => Promise<T>, db: any = prisma) {
  return db.$transaction(async (tx: any) => {
    // This project uses PostgreSQL. A transaction-scoped advisory lock makes a
    // toggle deterministic across rapid clicks, tabs, and multiple app nodes.
    const lockKey = BigInt(scope) * 4_294_967_296n + BigInt(targetId);
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
    return operation(tx);
  });
}

export function toggleMerchantFavorite(merchantProfileId: number, userId: number, db: any = prisma) {
  return lockedToggle(MERCHANT_FAVORITE_LOCK_SCOPE, merchantProfileId, async (tx) => {
    const key = { merchantProfileId_userId: { merchantProfileId, userId } };
    const existing = await tx.merchantFavorite.findUnique({ where: key, select: { id: true } });
    if (existing) await tx.merchantFavorite.delete({ where: { id: existing.id } });
    else await tx.merchantFavorite.create({ data: { merchantProfileId, userId } });
    const favoriteCount = await tx.merchantFavorite.count({ where: { merchantProfileId } });
    await tx.merchantProfile.update({ where: { id: merchantProfileId }, data: { favoriteCount } });
    return { favorited: !existing, favoriteCount };
  }, db);
}
