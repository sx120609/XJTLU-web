import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { invalidateForumCaches } from "./cacheInvalidation";
import { awardTransactionPointsInTransaction } from "./transactionPoints";

export const POINT_BOOST_COST = 10;
export const POINT_BOOST_DURATION_HOURS = 24;
const POINT_BOOST_LOCK_SCOPE = {
  topic: 1_205_012,
  market_item: 1_205_013,
  wanted_post: 1_205_014,
} as const;

export const pointBoostSchema = z.object({
  targetType: z.enum(["topic", "market_item", "wanted_post"]),
  targetId: z.number().int().positive(),
}).strict();

export type PointBoostInput = z.infer<typeof pointBoostSchema>;

export async function expirePointBoosts(now = new Date()) {
  await Promise.all([
    prisma.topic.updateMany({
      where: { boostedUntil: { lte: now } },
      data: { boostedUntil: null },
    }),
    prisma.marketItem.updateMany({
      where: { boostedUntil: { lte: now } },
      data: { boostedUntil: null },
    }),
    prisma.wantedPost.updateMany({
      where: { boostedUntil: { lte: now } },
      data: { boostedUntil: null },
    }),
  ]);
}

async function assertOwnedTarget(tx: any, userId: number, input: PointBoostInput, now: Date) {
  if (input.targetType === "topic") {
    const target = await tx.topic.findUnique({
      where: { id: input.targetId },
      select: { authorId: true, hidden: true, boostedUntil: true },
    });
    if (!target || target.authorId !== userId || target.hidden) throw Errors.notFound("可推流帖子不存在");
    if (target.boostedUntil && target.boostedUntil > now) throw Errors.conflict("该帖子正在推流中");
    return;
  }
  if (input.targetType === "market_item") {
    const target = await tx.marketItem.findUnique({
      where: { id: input.targetId },
      select: { sellerId: true, status: true, visibility: true, boostedUntil: true },
    });
    if (
      !target
      || target.sellerId !== userId
      || target.status !== "active"
      || target.visibility !== "public"
    ) {
      throw Errors.notFound("可推流商品不存在");
    }
    if (target.boostedUntil && target.boostedUntil > now) throw Errors.conflict("该商品正在推流中");
    return;
  }
  const target = await tx.wantedPost.findUnique({
    where: { id: input.targetId },
    select: { authorId: true, status: true, boostedUntil: true },
  });
  if (
    !target
    || target.authorId !== userId
    || !["active", "responded"].includes(target.status)
  ) {
    throw Errors.notFound("可推流求购不存在");
  }
  if (target.boostedUntil && target.boostedUntil > now) throw Errors.conflict("该求购正在推流中");
}

export async function createPointBoost(userId: number, input: PointBoostInput) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + POINT_BOOST_DURATION_HOURS * 60 * 60_000);
  const result = await prisma.$transaction(async (tx) => {
    const lockKey = BigInt(POINT_BOOST_LOCK_SCOPE[input.targetType]) * 4_294_967_296n
      + BigInt(input.targetId);
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
    await assertOwnedTarget(tx, userId, input, now);
    const boost = await tx.pointBoost.create({
      data: {
        userId,
        targetType: input.targetType,
        targetId: input.targetId,
        points: POINT_BOOST_COST,
        startsAt: now,
        expiresAt,
      },
    });
    const pointResult = await awardTransactionPointsInTransaction(tx, {
      userId,
      delta: -POINT_BOOST_COST,
      event: "content_boost_spent",
      sourceType: "point_boost",
      sourceId: boost.id,
      reason: `推流 24 小时（${input.targetType} #${input.targetId}）`,
    });
    if (pointResult.entry.delta !== -POINT_BOOST_COST) {
      throw Errors.badRequest(`积分不足，推流需要 ${POINT_BOOST_COST} 积分`);
    }

    const data = {
      boostedUntil: expiresAt,
      boostPointsSpent: { increment: POINT_BOOST_COST },
    };
    if (input.targetType === "topic") {
      await tx.topic.update({ where: { id: input.targetId }, data });
    } else if (input.targetType === "market_item") {
      await tx.marketItem.update({ where: { id: input.targetId }, data });
    } else {
      await tx.wantedPost.update({ where: { id: input.targetId }, data });
    }
    return {
      ...boost,
      remainingPoints: pointResult.level.points,
    };
  });
  if (input.targetType === "topic") {
    await invalidateForumCaches({ includeBoards: false });
  }
  return result;
}
