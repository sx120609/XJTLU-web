import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";

export const TRANSACTION_POINT_RULES = {
  physicalTradeBuyerCompleted: 10,
  physicalTradeSellerCompleted: 10,
  learningTradeBuyerCompleted: 10,
  learningTradeCreatorCompleted: 20,
  wantedResponseAccepted: 8,
  physicalReviewAuthored: 2,
  physicalPositiveReviewReceived: 5,
  learningRatingAuthored: 2,
  learningPositiveRatingReceived: 5,
  learningMaterialApproved: 15,
  validReport: 5,
} as const;

export const TRANSACTION_POINT_EVENT_LABELS: Record<string, string> = {
  physical_trade_buyer_completed: "完成实体交易（买家）",
  physical_trade_seller_completed: "完成实体交易（卖家）",
  learning_trade_buyer_completed: "完成学习资料订单",
  learning_trade_creator_completed: "完成学习资料交付",
  wanted_response_accepted: "求购响应被采纳",
  physical_review_authored: "发布成交评价",
  physical_positive_review_received: "收到四星及以上评价",
  learning_rating_authored: "发布资料评价",
  learning_positive_rating_received: "资料收到四星及以上评价",
  learning_material_approved: "学习资料审核通过",
  valid_report: "有效举报",
  content_boost_spent: "内容推流",
};

type DatabaseClient = Prisma.TransactionClient | typeof prisma;
const TRANSACTION_POINT_LOCK_SCOPE = 1_205_011;

export function transactionPointLevel(points: number) {
  const safePoints = Math.max(0, Math.floor(points || 0));
  return {
    points: safePoints,
    code: "points",
    label: "积分",
    currentFloor: 0,
    nextLevelAt: null,
    nextLevelLabel: null,
    pointsToNextLevel: 0,
    progress: 0,
  };
}

function eventLabel(event: string) {
  return TRANSACTION_POINT_EVENT_LABELS[event] || "交易积分调整";
}

async function lockPointBalance(tx: Prisma.TransactionClient, userId: number) {
  const lockKey = BigInt(TRANSACTION_POINT_LOCK_SCOPE) * 4_294_967_296n + BigInt(userId);
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
}

export type TransactionPointInput = {
  userId: number;
  delta: number;
  event: string;
  sourceType: string;
  sourceId: string | number;
  reason?: string;
};

/**
 * Apply one immutable, idempotent point event inside the caller's transaction.
 * A zero-delta entry is retained when a penalty hits a zero balance, preventing
 * a later retry from unexpectedly charging newly earned points.
 */
export async function awardTransactionPointsInTransaction(
  tx: Prisma.TransactionClient,
  input: TransactionPointInput,
) {
  await lockPointBalance(tx, input.userId);
  const sourceId = String(input.sourceId);
  const existing = await tx.transactionPointEntry.findUnique({
    where: {
      userId_event_sourceType_sourceId: {
        userId: input.userId,
        event: input.event,
        sourceType: input.sourceType,
        sourceId,
      },
    },
  });
  if (existing) {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { transactionPoints: true },
    });
    return {
      applied: false,
      entry: existing,
      level: transactionPointLevel(user?.transactionPoints || 0),
    };
  }

  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { transactionPoints: true },
  });
  if (!user) throw Errors.notFound("积分用户不存在");
  const requested = Math.trunc(input.delta);
  const appliedDelta = requested < 0
    ? -Math.min(user.transactionPoints, Math.abs(requested))
    : requested;
  const entry = await tx.transactionPointEntry.create({
    data: {
      userId: input.userId,
      delta: appliedDelta,
      event: input.event,
      sourceType: input.sourceType,
      sourceId,
      reason: (input.reason || eventLabel(input.event)).slice(0, 200),
    },
  });
  const updated = appliedDelta === 0
    ? user
    : await tx.user.update({
      where: { id: input.userId },
      data: { transactionPoints: { increment: appliedDelta } },
      select: { transactionPoints: true },
    });
  return {
    applied: true,
    entry,
    level: transactionPointLevel(updated.transactionPoints),
  };
}

export async function awardTransactionPoints(input: TransactionPointInput) {
  return prisma.$transaction((tx) => awardTransactionPointsInTransaction(tx, input));
}

export async function awardTransactionPointsBatchInTransaction(
  tx: Prisma.TransactionClient,
  inputs: TransactionPointInput[],
) {
  const userIds = [...new Set(inputs.map((input) => input.userId))].sort((a, b) => a - b);
  for (const userId of userIds) await lockPointBalance(tx, userId);
  const ordered = [...inputs].sort((a, b) => (
    a.userId - b.userId
    || a.event.localeCompare(b.event)
    || String(a.sourceId).localeCompare(String(b.sourceId))
  ));
  const results = [];
  for (const input of ordered) {
    results.push(await awardTransactionPointsInTransaction(tx, input));
  }
  return results;
}

export function violationPointPenalty(level: string) {
  void level;
  return 0;
}

export async function restoreViolationPointsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    userId: number;
    originalEvent: "market_violation" | "learning_violation";
    restoreEvent: "market_violation_restored" | "learning_violation_restored";
    sourceType: "market_violation" | "learning_violation";
    sourceId: string | number;
    reason: string;
  },
) {
  const sourceId = String(input.sourceId);
  const penalty = await tx.transactionPointEntry.findUnique({
    where: {
      userId_event_sourceType_sourceId: {
        userId: input.userId,
        event: input.originalEvent,
        sourceType: input.sourceType,
        sourceId,
      },
    },
    select: { delta: true },
  });
  if (!penalty || penalty.delta >= 0) return null;
  return awardTransactionPointsInTransaction(tx, {
    userId: input.userId,
    delta: -penalty.delta,
    event: input.restoreEvent,
    sourceType: input.sourceType,
    sourceId,
    reason: input.reason,
  });
}

export async function getTransactionPointSummary(
  db: DatabaseClient,
  userId: number,
  includeEntries = false,
) {
  const [user, entries] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { transactionPoints: true } }),
    includeEntries
      ? db.transactionPointEntry.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          delta: true,
          event: true,
          sourceType: true,
          sourceId: true,
          reason: true,
          createdAt: true,
        },
      })
      : Promise.resolve([]),
  ]);
  if (!user) throw Errors.notFound("用户不存在");
  return {
    ...transactionPointLevel(user.transactionPoints),
    recentEntries: entries.map((entry) => ({
      ...entry,
      label: eventLabel(entry.event),
    })),
  };
}
