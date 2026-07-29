import type { Prisma } from "@prisma/client";

export const EPAY_CONFIG_LOCK_KEY = 1_205_011n * 4_294_967_296n + 1n;

/**
 * Serializes payment configuration changes with sponsor order creation.
 * This keeps a signed payment page and its persisted order on one merchant
 * configuration revision.
 */
export async function acquireEpayConfigLock(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${EPAY_CONFIG_LOCK_KEY})
  `;
}
