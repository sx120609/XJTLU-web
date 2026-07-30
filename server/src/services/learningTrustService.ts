import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import { containsOffPlatformContact } from "./learningMaterials";
import type { LearningCommerceActor } from "./learningCommerceService";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { evaluateMarketContent } from "./marketTrust";
import {
  TRANSACTION_POINT_RULES,
  awardTransactionPointsBatchInTransaction,
  awardTransactionPointsInTransaction,
} from "./transactionPoints";
import {
  applyReputationPenalty,
  restoreReputationPenalty,
} from "./reputation";

type TransactionClient = Prisma.TransactionClient;
type DatabaseClient = TransactionClient | typeof prisma;

const ACTIVE_GOVERNANCE_ACTIONS = ["suspend_7d", "suspend_30d", "revoke"];

function roundedRate(part: number, total: number) {
  return total > 0 ? Math.min(10_000, Math.round((part / total) * 10_000)) : 0;
}

export async function refreshLearningCreatorMetrics(
  creatorId: number,
  db: DatabaseClient = prisma,
) {
  const [orders, ratingAggregate, activeViolations] = await Promise.all([
    db.learningCommerceOrder.findMany({
      where: {
        order: { sellerId: creatorId },
        status: { in: ["awaiting_seller_confirmation", "disputed", "delivered", "completed", "refunded"] },
      },
      select: {
        status: true,
        deliveredAt: true,
        issues: {
          select: { id: true },
          take: 1,
        },
        paymentEvidence: {
          where: { status: "accepted" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { handledAt: true, createdAt: true },
        },
      },
    }),
    db.learningMaterialRating.aggregate({
      where: { creatorId, status: "published" },
      _count: { id: true },
      _avg: { overall: true },
    }),
    db.learningCreatorViolation.findMany({
      where: {
        creatorId,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { severity: true },
    }),
  ]);
  const completedOrderCount = orders.filter((row) => row.status === "completed").length;
  const refundRateBps = roundedRate(
    orders.filter((row) => row.status === "refunded").length,
    orders.length,
  );
  const disputeRateBps = roundedRate(
    orders.filter((row) => row.status === "disputed" || row.issues.length > 0).length,
    orders.length,
  );
  const confirmMinutes = orders.flatMap((row) => {
    const submittedAt = row.paymentEvidence[0]?.createdAt;
    if (!submittedAt || !row.deliveredAt) return [];
    return [Math.max(0, Math.round((row.deliveredAt.getTime() - submittedAt.getTime()) / 60_000))];
  });
  const averageConfirmMinutes = confirmMinutes.length
    ? Math.round(confirmMinutes.reduce((total, value) => total + value, 0) / confirmMinutes.length)
    : null;
  const ratingCount = ratingAggregate._count.id;
  const averageRatingBps = ratingCount
    ? Math.round(Number(ratingAggregate._avg.overall || 0) * 100)
    : 0;
  const ratingAdjustment = ratingCount ? Math.round((averageRatingBps - 300) / 10) : 0;
  const violationPenalty = activeViolations.reduce(
    (total, row) => total + (row.severity === "critical" ? 30 : row.severity === "high" ? 20 : row.severity === "medium" ? 10 : 5),
    0,
  );
  const qualityScore = Math.max(0, Math.min(
    100,
    60
      + Math.min(10, completedOrderCount)
      + ratingAdjustment
      - Math.round(refundRateBps / 400)
      - Math.round(disputeRateBps / 650)
      - violationPenalty,
  ));
  const level = (
    qualityScore >= 90 && completedOrderCount >= 20 && averageRatingBps >= 450
      ? "excellent"
      : qualityScore >= 78 && completedOrderCount >= 5
        ? "reliable"
        : "certified"
  );
  return db.learningCreatorProfile.update({
    where: { userId: creatorId },
    data: {
      level,
      qualityScore,
      completedOrderCount,
      ratingCount,
      averageRatingBps,
      refundRateBps,
      disputeRateBps,
      averageConfirmMinutes,
      metricsUpdatedAt: new Date(),
    },
  });
}

export async function listLearningMaterialRatings(itemId: number) {
  const [ratings, aggregate] = await Promise.all([
    prisma.learningMaterialRating.findMany({
      where: { itemId, status: "published" },
      include: { buyer: { select: MARKET_PUBLIC_USER_SELECT } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.learningMaterialRating.aggregate({
      where: { itemId, status: "published" },
      _count: { id: true },
      _avg: {
        overall: true,
        accuracy: true,
        usefulness: true,
        descriptionMatch: true,
        fileQuality: true,
      },
    }),
  ]);
  return {
    summary: {
      count: aggregate._count.id,
      overall: Number((aggregate._avg.overall || 0).toFixed(2)),
      accuracy: Number((aggregate._avg.accuracy || 0).toFixed(2)),
      usefulness: Number((aggregate._avg.usefulness || 0).toFixed(2)),
      descriptionMatch: Number((aggregate._avg.descriptionMatch || 0).toFixed(2)),
      fileQuality: Number((aggregate._avg.fileQuality || 0).toFixed(2)),
    },
    list: ratings.map((rating) => ({
      ...rating,
      buyer: rating.buyer,
    })),
  };
}

export async function rateLearningMaterialOrder(
  actor: LearningCommerceActor,
  commerceOrderId: number,
  input: {
    accuracy: number;
    usefulness: number;
    descriptionMatch: number;
    fileQuality: number;
    content: string;
  },
) {
  if (containsOffPlatformContact(input.content)) {
    throw Errors.badRequest("评价中不能发布联系方式、外部链接或私下交易信息");
  }
  const contentSafety = await evaluateMarketContent(prisma, [input.content], "learning");
  if (contentSafety.action === "block") {
    throw Errors.badRequest(contentSafety.matches[0]?.note || "评价内容不符合社区规则");
  }
  const current = await prisma.learningCommerceOrder.findUnique({
    where: { id: commerceOrderId },
    select: { orderId: true },
  });
  if (!current) throw Errors.notFound("学习资料订单不存在");
  const overall = Math.round((
    input.accuracy
    + input.usefulness
    + input.descriptionMatch
    + input.fileQuality
  ) / 4);
  const ratingStatus = contentSafety.action === "review" ? "hidden" : "published";
  const moderationReason = contentSafety.action === "review"
    ? (contentSafety.matches[0]?.note || "评价正在等待人工复核")
    : "";
  return prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, current.orderId);
    const row = await tx.learningCommerceOrder.findUnique({
      where: { id: commerceOrderId },
      include: { order: true },
    });
    if (!row) throw Errors.notFound("学习资料订单不存在");
    if (row.order.buyerId !== actor.userId) throw Errors.forbidden("只有实际买家可以评价该资料");
    if (row.status !== "completed") throw Errors.badRequest("订单完成后才可以发布已购评价");
    const rating = await tx.learningMaterialRating.upsert({
      where: { commerceOrderId },
      update: {
        ...input,
        overall,
        status: ratingStatus,
        moderationReason,
      },
      create: {
        commerceOrderId,
        itemId: row.order.itemId,
        versionId: row.versionId,
        buyerId: row.order.buyerId,
        creatorId: row.order.sellerId,
        ...input,
        overall,
        status: ratingStatus,
        moderationReason,
      },
      include: { buyer: { select: MARKET_PUBLIC_USER_SELECT } },
    });
    if (ratingStatus === "published") {
      await awardTransactionPointsBatchInTransaction(tx, [
        {
          userId: row.order.buyerId,
          delta: TRANSACTION_POINT_RULES.learningRatingAuthored,
          event: "learning_rating_authored",
          sourceType: "learning_rating",
          sourceId: rating.id,
        },
        ...(overall >= 4 ? [{
          userId: row.order.sellerId,
          delta: TRANSACTION_POINT_RULES.learningPositiveRatingReceived,
          event: "learning_positive_rating_received",
          sourceType: "learning_rating",
          sourceId: rating.id,
        }] : []),
      ]);
    }
    await refreshLearningCreatorMetrics(row.order.sellerId, tx);
    return rating;
  });
}

export async function reconcileLearningCreatorGovernance(userId: number) {
  const now = new Date();
  await prisma.learningCreatorViolation.updateMany({
    where: {
      creatorId: userId,
      status: "active",
      expiresAt: { lte: now },
    },
    data: { status: "expired" },
  });
  const activeBlocking = await prisma.learningCreatorViolation.count({
    where: {
      creatorId: userId,
      status: "active",
      action: { in: ACTIVE_GOVERNANCE_ACTIONS },
    },
  });
  if (!activeBlocking) {
    await prisma.learningCreatorProfile.updateMany({
      where: { userId, status: "suspended" },
      data: { status: "active", statusReason: "" },
    });
  }
}

export async function listLearningCreatorViolations(
  actor: LearningCommerceActor,
  creatorId?: number,
) {
  const staff = ["admin", "mod"].includes(actor.role);
  if (!staff && creatorId && creatorId !== actor.userId) throw Errors.forbidden("无权查看其他资料发布者的治理记录");
  return prisma.learningCreatorViolation.findMany({
    where: { creatorId: staff ? creatorId : actor.userId },
    include: {
      creator: { select: MARKET_PUBLIC_USER_SELECT },
      createdBy: { select: MARKET_PUBLIC_USER_SELECT },
      appeals: {
        include: {
          user: { select: MARKET_PUBLIC_USER_SELECT },
          handledBy: { select: MARKET_PUBLIC_USER_SELECT },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 300,
  });
}

export async function createLearningCreatorViolation(
  actor: LearningCommerceActor,
  input: {
    creatorId: number;
    itemId?: number;
    commerceOrderId?: number;
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    action: "warn" | "hide_material" | "suspend_7d" | "suspend_30d" | "revoke";
    reason: string;
    evidence: string;
  },
) {
  if (!["admin", "mod"].includes(actor.role)) throw Errors.forbidden("仅运营人员可以登记资料发布者违规");
  const result = await prisma.$transaction(async (tx) => {
    const profile = await tx.learningCreatorProfile.findUnique({ where: { userId: input.creatorId } });
    if (!profile) throw Errors.notFound("资料发布者档案不存在");
    if (input.itemId) {
      const item = await tx.marketItem.findFirst({ where: { id: input.itemId, sellerId: input.creatorId } });
      if (!item) throw Errors.badRequest("关联资料不属于该资料发布者");
      if (input.action === "hide_material" && item.status !== "active") {
        throw Errors.conflict("只能对当前公开上架的资料执行隐藏动作");
      }
    }
    if (input.commerceOrderId) {
      const order = await tx.learningCommerceOrder.findFirst({
        where: { id: input.commerceOrderId, order: { sellerId: input.creatorId } },
      });
      if (!order) throw Errors.badRequest("关联订单不属于该资料发布者");
    }
    const now = new Date();
    const expiresAt = input.action === "suspend_7d"
      ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      : input.action === "suspend_30d"
        ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        : null;
    const reputationDelta = await applyReputationPenalty(tx, input.creatorId, input.severity);
    const violation = await tx.learningCreatorViolation.create({
      data: {
        ...input,
        itemId: input.itemId || null,
        commerceOrderId: input.commerceOrderId || null,
        createdById: actor.userId,
        expiresAt,
        reputationDelta,
      },
    });
    if (input.action === "hide_material" && input.itemId) {
      await tx.marketItem.update({
        where: { id: input.itemId },
        data: { status: "hidden", moderationNote: input.reason, moderatedAt: now },
      });
    }
    if (ACTIVE_GOVERNANCE_ACTIONS.includes(input.action)) {
      await tx.learningCreatorProfile.update({
        where: { userId: input.creatorId },
        data: {
          status: input.action === "revoke" || profile.status === "revoked"
            ? "revoked"
            : "suspended",
          statusReason: input.reason,
          lastReviewedAt: now,
          qualityScore: Math.max(
            0,
            profile.qualityScore - (input.severity === "critical" ? 30 : input.severity === "high" ? 20 : 10),
          ),
        },
      });
    }
    await tx.adminActionLog.create({
      data: {
        actorId: actor.userId,
        action: "learning_creator_violation_create",
        targetType: "LearningCreatorViolation",
        targetId: String(violation.id),
        summary: `创作者治理：${input.action}`,
        detail: JSON.stringify(input),
      },
    });
    await refreshLearningCreatorMetrics(input.creatorId, tx);
    return violation;
  });
  await notifyMarketUser(
    input.creatorId,
    "学习资料创作者治理记录已更新",
    input.reason,
    "/learning/creator",
    { type: "learning-creator-violation", violationId: result.id, action: result.action },
  );
  return result;
}

export async function appealLearningCreatorViolation(
  actor: LearningCommerceActor,
  violationId: number,
  content: string,
) {
  const violation = await prisma.learningCreatorViolation.findUnique({ where: { id: violationId } });
  if (!violation) throw Errors.notFound("违规记录不存在");
  if (violation.creatorId !== actor.userId) throw Errors.forbidden("只能申诉本人的违规记录");
  if (violation.status !== "active") throw Errors.badRequest("该记录当前无需申诉");
  return prisma.learningCreatorAppeal.upsert({
    where: { violationId_userId: { violationId, userId: actor.userId } },
    update: { content, status: "pending", handledById: null, handleNote: "", handledAt: null },
    create: { violationId, userId: actor.userId, content },
  });
}

export async function decideLearningCreatorAppeal(
  actor: LearningCommerceActor,
  appealId: number,
  input: { action: "approve" | "reject"; note: string },
) {
  if (!["admin", "mod"].includes(actor.role)) throw Errors.forbidden("仅运营人员可以处理申诉");
  const result = await prisma.$transaction(async (tx) => {
    const appeal = await tx.learningCreatorAppeal.findUnique({
      where: { id: appealId },
      include: { violation: true },
    });
    if (!appeal || appeal.status !== "pending") throw Errors.conflict("申诉不存在或已经处理");
    const now = new Date();
    const updated = await tx.learningCreatorAppeal.update({
      where: { id: appealId },
      data: {
        status: input.action === "approve" ? "approved" : "rejected",
        handledById: actor.userId,
        handleNote: input.note,
        handledAt: now,
      },
    });
    if (input.action === "approve") {
      await tx.learningCreatorViolation.update({
        where: { id: appeal.violationId },
        data: { status: "revoked", revokedAt: now },
      });
      await restoreReputationPenalty(
        tx,
        appeal.violation.creatorId,
        appeal.violation.reputationDelta,
      );
      const remainingBlocking = await tx.learningCreatorViolation.findMany({
        where: {
          creatorId: appeal.violation.creatorId,
          id: { not: appeal.violationId },
          status: "active",
          action: { in: ACTIVE_GOVERNANCE_ACTIONS },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { action: true, reason: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const remainingRevoke = remainingBlocking.find((row) => row.action === "revoke");
      await tx.learningCreatorProfile.update({
        where: { userId: appeal.violation.creatorId },
        data: remainingBlocking.length
          ? {
            status: remainingRevoke ? "revoked" : "suspended",
            statusReason: (remainingRevoke || remainingBlocking[0]).reason,
            lastReviewedAt: now,
          }
          : { status: "active", statusReason: "", lastReviewedAt: now },
      });
      await refreshLearningCreatorMetrics(appeal.violation.creatorId, tx);
    }
    await tx.adminActionLog.create({
      data: {
        actorId: actor.userId,
        action: input.action === "approve"
          ? "learning_creator_appeal_approved"
          : "learning_creator_appeal_rejected",
        targetType: "LearningCreatorAppeal",
        targetId: String(appealId),
        summary: input.action === "approve" ? "通过创作者治理申诉" : "驳回创作者治理申诉",
        detail: JSON.stringify({
          violationId: appeal.violationId,
          creatorId: appeal.violation.creatorId,
          note: input.note,
        }),
      },
    });
    return updated;
  });
  await notifyMarketUser(
    result.userId,
    input.action === "approve" ? "学习资料治理申诉已通过" : "学习资料治理申诉复核完成",
    input.note,
    "/learning/creator",
    { type: "learning-creator-appeal", appealId, status: result.status },
  );
  return result;
}
