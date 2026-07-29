import type { Prisma } from "@prisma/client";

export const FORUM_TOPIC_LOCK_SCOPE = 1_205_050;

export function forumTopicLockKey(topicId: number) {
  return BigInt(FORUM_TOPIC_LOCK_SCOPE) * 4_294_967_296n + BigInt(topicId);
}

/**
 * Serializes reply floor allocation and moderation changes for one topic.
 * Every application path that creates, restores, hides, or destroys replies
 * should acquire this transaction-scoped lock before reading mutable state.
 */
export async function acquireForumTopicLock(
  tx: Prisma.TransactionClient,
  topicId: number,
) {
  const lockKey = forumTopicLockKey(topicId);
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${lockKey})
  `;
}
