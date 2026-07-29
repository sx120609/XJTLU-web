import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import {
  acquireMarketGovernanceLock,
  type MarketGovernanceLockScope,
} from "./marketGovernanceLockService";
import {
  evaluateMarketContent,
  getMarketTrustProfile,
  logMarketAdminAction,
} from "./marketTrust";
import { acquireMarketWantedLock } from "./marketWantedLockService";
import { hideMarketItemForReportInTransaction } from "./marketItemWriteService";
import { syncPersistedWantedDemandTopic } from "./wantedDemandTopic";
import { ensureUserCanSpeak } from "./userModeration";
import { closePendingWantedInterest } from "./marketWantedService";
import {
  TRANSACTION_POINT_RULES,
  awardTransactionPointsBatchInTransaction,
  awardTransactionPointsInTransaction,
  restoreViolationPointsInTransaction,
  violationPointPenalty,
} from "./transactionPoints";

export const marketReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().max(500).optional().default(""),
}).strict();

export const marketAppealCreateSchema = z.object({
  content: z.string().trim().min(10).max(2000),
}).strict();

export const marketReportSchema = z.object({
  reason: z.string().trim().min(2).max(80),
  detail: z.string().trim().max(1000).optional().default(""),
}).strict();

const marketSafetyRuleBaseSchema = z.object({
  keyword: z.string().trim().min(1).max(80),
  scope: z.enum(["market", "forum", "learning", "all"]),
  category: z.string().trim().min(1).max(80),
  action: z.enum(["block", "review"]),
  enabled: z.boolean(),
  note: z.string().trim().max(500),
});

export const marketSafetyRuleSchema = marketSafetyRuleBaseSchema.extend({
  scope: marketSafetyRuleBaseSchema.shape.scope.default("market"),
  category: marketSafetyRuleBaseSchema.shape.category.default("prohibited"),
  action: marketSafetyRuleBaseSchema.shape.action.default("block"),
  enabled: marketSafetyRuleBaseSchema.shape.enabled.default(true),
  note: marketSafetyRuleBaseSchema.shape.note.default(""),
}).strict();

export const marketSafetyRulePatchSchema = marketSafetyRuleBaseSchema
  .partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, "请至少提交一个要修改的字段");

export const marketViolationCreateSchema = z.object({
  userId: z.number().int().positive(),
  itemId: z.number().int().positive().optional().nullable(),
  wantedPostId: z.number().int().positive().optional().nullable(),
  orderId: z.number().int().positive().optional().nullable(),
  type: z.string().trim().min(2).max(80),
  level: z.enum(["warning", "moderate", "serious"]).default("warning"),
  action: z.enum(["warning", "restrict_publish", "restrict_trade"]).default("warning"),
  reason: z.string().trim().min(2).max(500),
  expiresAt: z.coerce.date().optional().nullable(),
}).strict().superRefine((input, context) => {
  const referenceCount = [input.itemId, input.wantedPostId, input.orderId]
    .filter((value) => value !== null && value !== undefined)
    .length;
  if (referenceCount > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "一条违规记录只能关联一个商品、求购或订单",
    });
  }
});

export const marketViolationRevokeSchema = z.object({
  status: z.literal("revoked"),
  note: z.string().trim().max(500).optional().default(""),
}).strict();

export const marketAppealActionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(2).max(500),
}).strict();

export const marketAdminReportActionSchema = z.object({
  status: z.enum(["resolved", "rejected"]),
  note: z.string().trim().max(500).optional().default(""),
  hideItem: z.boolean().optional().default(false),
}).strict().superRefine((input, context) => {
  if (input.hideItem && input.status !== "resolved") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hideItem"],
      message: "只有确认举报成立时才能隐藏目标",
    });
  }
});

export type MarketGovernanceActor = {
  userId: number;
  role: string;
  ip?: string;
};

export type MarketReviewInput = z.infer<typeof marketReviewSchema>;
export type MarketAppealCreateInput = z.infer<typeof marketAppealCreateSchema>;
export type MarketReportInput = z.infer<typeof marketReportSchema>;
export type MarketSafetyRuleInput = z.infer<typeof marketSafetyRuleSchema>;
export type MarketSafetyRulePatch = z.infer<typeof marketSafetyRulePatchSchema>;
export type MarketViolationCreateInput = z.infer<typeof marketViolationCreateSchema>;
export type MarketViolationRevokeInput = z.infer<typeof marketViolationRevokeSchema>;
export type MarketAppealActionInput = z.infer<typeof marketAppealActionSchema>;
export type MarketAdminReportActionInput = z.infer<typeof marketAdminReportActionSchema>;

export type MarketReportTarget =
  | { kind: "item"; id: number }
  | { kind: "wanted"; id: number }
  | { kind: "user"; id: number }
  | { kind: "order"; id: number };

export function requireMarketGovernanceStaff(role: string) {
  if (!["admin", "mod"].includes(role)) {
    throw Errors.forbidden("需要商城管理权限");
  }
}

function prismaCode(error: unknown) {
  return String((error as { code?: unknown })?.code || "");
}

async function notifyMarketStaff(
  title: string,
  content: string,
  payload: Record<string, unknown>,
  level: "normal" | "strong" = "strong",
) {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ["admin", "mod"] } },
      select: { id: true },
    });
    if (!staff.length) return;
    await prisma.notification.createMany({
      data: staff.map((user) => ({
        userId: user.id,
        category: "market",
        level,
        title,
        content,
        link: "/admin?tab=market",
        source: "靠浦校园市集",
        payload: JSON.stringify(payload),
      })),
    });
  } catch {
    // Governance writes are authoritative; notification delivery is best-effort.
  }
}

export async function createMarketReview(
  actor: MarketGovernanceActor,
  orderId: number,
  input: MarketReviewInput,
) {
  await ensureUserCanSpeak(actor.userId);
  const safety = await evaluateMarketContent(prisma, [input.content]);
  if (safety.action !== "allow") {
    throw Errors.badRequest("评价包含不适合公开展示的信息，请修改后再提交");
  }

  let result: {
    review: any;
    targetUserId: number;
    itemTitle: string;
  };
  try {
    result = await prisma.$transaction(async (tx) => {
      await acquireMarketOrderLock(tx, orderId);
      const order = await tx.marketOrder.findUnique({
        where: { id: orderId },
        include: { item: { select: { title: true } } },
      });
      if (
        !order
        || (order.buyerId !== actor.userId && order.sellerId !== actor.userId)
      ) {
        throw Errors.notFound("订单不存在");
      }
      if (order.status !== "completed") {
        throw Errors.badRequest("交易完成后才能评价");
      }
      if (order.deliveryType !== "physical") {
        throw Errors.badRequest("学习资料订单请使用已购资料评价");
      }
      const targetUserId = order.buyerId === actor.userId
        ? order.sellerId
        : order.buyerId;
      const review = await tx.marketReview.create({
        data: {
          orderId,
          authorId: actor.userId,
          targetUserId,
          rating: input.rating,
          content: input.content,
        },
      });
      await awardTransactionPointsBatchInTransaction(tx, [
        {
          userId: actor.userId,
          delta: TRANSACTION_POINT_RULES.physicalReviewAuthored,
          event: "physical_review_authored",
          sourceType: "market_review",
          sourceId: review.id,
        },
        ...(input.rating >= 4 ? [{
          userId: targetUserId,
          delta: TRANSACTION_POINT_RULES.physicalPositiveReviewReceived,
          event: "physical_positive_review_received",
          sourceType: "market_review",
          sourceId: review.id,
        }] : []),
      ]);
      return { review, targetUserId, itemTitle: order.item.title };
    });
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      throw Errors.conflict("你已经评价过该交易");
    }
    throw error;
  }

  await notifyMarketUser(
    result.targetUserId,
    "收到新的交易评价",
    `「${result.itemTitle}」的交易对方给出了 ${result.review.rating} 星评价`,
    "/market/mine?tab=orders",
    {
      type: "market-review",
      orderId,
      reviewId: result.review.id,
    },
  );
  return result.review;
}

export async function listMarketReviews(targetUserId: number) {
  const [list, summary] = await Promise.all([
    prisma.marketReview.findMany({
      where: { targetUserId },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        order: {
          select: {
            id: true,
            item: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    prisma.marketReview.aggregate({
      where: { targetUserId },
      _avg: { rating: true },
      _count: true,
    }),
  ]);
  return {
    list,
    average: Number(summary._avg.rating || 0),
    total: Number(summary._count || 0),
  };
}

export async function getPublicMarketTrustProfile(userId: number) {
  return getMarketTrustProfile(prisma, userId, false);
}

export async function getPrivateMarketTrustProfile(userId: number) {
  return getMarketTrustProfile(prisma, userId, true);
}

export async function createMarketAppeal(
  actor: MarketGovernanceActor,
  violationId: number,
  input: MarketAppealCreateInput,
) {
  let appeal: any;
  try {
    appeal = await prisma.$transaction(async (tx) => {
      await acquireMarketGovernanceLock(tx, "violation", violationId);
      const violation = await tx.marketViolation.findUnique({
        where: { id: violationId },
      });
      if (!violation || violation.userId !== actor.userId) {
        throw Errors.notFound("违规记录不存在");
      }
      if (
        violation.status !== "active"
        || (violation.expiresAt && violation.expiresAt <= new Date())
      ) {
        throw Errors.badRequest("该记录当前不能申诉");
      }
      return tx.marketAppeal.create({
        data: {
          violationId,
          userId: actor.userId,
          content: input.content,
        },
      });
    });
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      throw Errors.conflict("该违规记录已经提交过申诉");
    }
    throw error;
  }

  await notifyMarketStaff(
    "收到市集违规申诉",
    `违规记录 ${violationId} 收到新申诉`,
    {
      type: "market-appeal",
      violationId,
      appealId: appeal.id,
    },
    "normal",
  );
  return appeal;
}

function reportLockScope(target: MarketReportTarget): MarketGovernanceLockScope {
  if (target.kind === "item") return "reportItem";
  if (target.kind === "wanted") return "reportWanted";
  if (target.kind === "user") return "reportUser";
  return "reportOrder";
}

export async function createMarketReport(
  actor: MarketGovernanceActor,
  target: MarketReportTarget,
  input: MarketReportInput,
) {
  let result: {
    report: any;
    notificationTitle: string;
    notificationContent: string;
    notificationPayload: Record<string, unknown>;
  };
  try {
    result = await prisma.$transaction(async (tx) => {
      await acquireMarketGovernanceLock(tx, reportLockScope(target), target.id);

      if (target.kind === "item") {
        const item = await tx.marketItem.findUnique({
          where: { id: target.id },
          select: { id: true, sellerId: true, title: true },
        });
        if (!item) throw Errors.notFound("商品不存在");
        if (item.sellerId === actor.userId) {
          throw Errors.badRequest("不能举报自己发布的商品");
        }
        const duplicate = await tx.marketReport.findFirst({
          where: { itemId: target.id, reporterId: actor.userId },
          select: { id: true },
        });
        if (duplicate) throw Errors.conflict("你已经举报过该商品");
        const report = await tx.marketReport.create({
          data: {
            itemId: target.id,
            reporterId: actor.userId,
            reportedUserId: item.sellerId,
            type: "listing",
            reason: input.reason,
            detail: input.detail,
          },
        });
        return {
          report,
          notificationTitle: "收到商品举报",
          notificationContent: `「${item.title}」被举报：${input.reason}`,
          notificationPayload: {
            type: "market-report",
            itemId: target.id,
            reportId: report.id,
          },
        };
      }

      if (target.kind === "wanted") {
        const post = await tx.wantedPost.findUnique({
          where: { id: target.id },
          select: { id: true, authorId: true, title: true },
        });
        if (!post) throw Errors.notFound("求购不存在");
        if (post.authorId === actor.userId) {
          throw Errors.badRequest("不能举报自己发布的求购");
        }
        const duplicate = await tx.marketReport.findFirst({
          where: { wantedPostId: target.id, reporterId: actor.userId },
          select: { id: true },
        });
        if (duplicate) throw Errors.conflict("你已经举报过该求购");
        const report = await tx.marketReport.create({
          data: {
            wantedPostId: target.id,
            reporterId: actor.userId,
            reportedUserId: post.authorId,
            type: "wanted",
            reason: input.reason,
            detail: input.detail,
          },
        });
        return {
          report,
          notificationTitle: "收到求购举报",
          notificationContent: `「${post.title}」被举报：${input.reason}`,
          notificationPayload: {
            type: "market-wanted-report",
            wantedPostId: target.id,
            reportId: report.id,
          },
        };
      }

      if (target.kind === "user") {
        if (target.id === actor.userId) throw Errors.badRequest("不能举报自己");
        const user = await tx.user.findUnique({
          where: { id: target.id },
          select: MARKET_PUBLIC_USER_SELECT,
        });
        if (!user) throw Errors.notFound("用户不存在");
        const duplicate = await tx.marketReport.findFirst({
          where: {
            type: "user",
            reportedUserId: target.id,
            reporterId: actor.userId,
            status: "pending",
          },
          select: { id: true },
        });
        if (duplicate) {
          throw Errors.conflict("你已经提交过对该用户的待处理举报");
        }
        const report = await tx.marketReport.create({
          data: {
            reportedUserId: target.id,
            reporterId: actor.userId,
            type: "user",
            reason: input.reason,
            detail: input.detail,
          },
        });
        return {
          report,
          notificationTitle: "收到用户举报",
          notificationContent: `${user.nickname} 被举报：${input.reason}`,
          notificationPayload: {
            type: "market-user-report",
            reportedUserId: target.id,
            reportId: report.id,
          },
        };
      }

      const order = await tx.marketOrder.findUnique({
        where: { id: target.id },
        include: { item: { select: { title: true } } },
      });
      if (
        !order
        || (order.buyerId !== actor.userId && order.sellerId !== actor.userId)
      ) {
        throw Errors.notFound("交易记录不存在");
      }
      const duplicate = await tx.marketReport.findFirst({
        where: { orderId: target.id, reporterId: actor.userId },
        select: { id: true },
      });
      if (duplicate) throw Errors.conflict("你已经举报过该交易");
      const reportedUserId = order.buyerId === actor.userId
        ? order.sellerId
        : order.buyerId;
      const report = await tx.marketReport.create({
        data: {
          orderId: target.id,
          reporterId: actor.userId,
          reportedUserId,
          type: "trade",
          reason: input.reason,
          detail: input.detail,
        },
      });
      return {
        report,
        notificationTitle: "收到交易举报",
        notificationContent: `「${order.item.title}」的交易被举报：${input.reason}`,
        notificationPayload: {
          type: "market-trade-report",
          orderId: target.id,
          reportId: report.id,
        },
      };
    });
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      throw Errors.conflict("你已经举报过该对象");
    }
    throw error;
  }

  await notifyMarketStaff(
    result.notificationTitle,
    result.notificationContent,
    result.notificationPayload,
  );
  return result.report;
}

export async function createMarketSafetyRule(
  actor: MarketGovernanceActor,
  input: MarketSafetyRuleInput,
) {
  requireMarketGovernanceStaff(actor.role);
  try {
    return await prisma.$transaction(async (tx) => {
      const rule = await tx.marketSafetyRule.create({
        data: { ...input, createdById: actor.userId },
      });
      await logMarketAdminAction(tx, {
        actorId: actor.userId,
        action: "market.safety_rule.create",
        targetType: "market_safety_rule",
        targetId: rule.id,
        summary: `新增市集安全规则：${rule.keyword}`,
        detail: {
          category: rule.category,
          action: rule.action,
          enabled: rule.enabled,
        },
        ip: actor.ip,
      });
      return rule;
    });
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      throw Errors.conflict("该关键词规则已存在");
    }
    throw error;
  }
}

export async function updateMarketSafetyRule(
  actor: MarketGovernanceActor,
  ruleId: number,
  input: MarketSafetyRulePatch,
) {
  requireMarketGovernanceStaff(actor.role);
  try {
    return await prisma.$transaction(async (tx) => {
      const rule = await tx.marketSafetyRule.update({
        where: { id: ruleId },
        data: input,
      });
      await logMarketAdminAction(tx, {
        actorId: actor.userId,
        action: "market.safety_rule.update",
        targetType: "market_safety_rule",
        targetId: ruleId,
        summary: `更新市集安全规则：${rule.keyword}`,
        detail: input,
        ip: actor.ip,
      });
      return rule;
    });
  } catch (error) {
    if (prismaCode(error) === "P2025") throw Errors.notFound("安全规则不存在");
    if (prismaCode(error) === "P2002") throw Errors.conflict("该关键词规则已存在");
    throw error;
  }
}

export async function deleteMarketSafetyRule(
  actor: MarketGovernanceActor,
  ruleId: number,
) {
  requireMarketGovernanceStaff(actor.role);
  try {
    return await prisma.$transaction(async (tx) => {
      const rule = await tx.marketSafetyRule.delete({ where: { id: ruleId } });
      await logMarketAdminAction(tx, {
        actorId: actor.userId,
        action: "market.safety_rule.delete",
        targetType: "market_safety_rule",
        targetId: ruleId,
        summary: `删除市集安全规则：${rule.keyword}`,
        detail: { category: rule.category, action: rule.action },
        ip: actor.ip,
      });
      return { ok: true as const };
    });
  } catch (error) {
    if (prismaCode(error) === "P2025") throw Errors.notFound("安全规则不存在");
    throw error;
  }
}

async function validateViolationReference(
  tx: any,
  input: MarketViolationCreateInput,
) {
  if (input.itemId) {
    const item = await tx.marketItem.findUnique({
      where: { id: input.itemId },
      select: { sellerId: true },
    });
    if (!item) throw Errors.notFound("关联商品不存在");
    if (item.sellerId !== input.userId) {
      throw Errors.badRequest("关联商品不属于处理对象");
    }
  }
  if (input.wantedPostId) {
    const post = await tx.wantedPost.findUnique({
      where: { id: input.wantedPostId },
      select: { authorId: true },
    });
    if (!post) throw Errors.notFound("关联求购不存在");
    if (post.authorId !== input.userId) {
      throw Errors.badRequest("关联求购不属于处理对象");
    }
  }
  if (input.orderId) {
    const order = await tx.marketOrder.findUnique({
      where: { id: input.orderId },
      select: { buyerId: true, sellerId: true },
    });
    if (!order) throw Errors.notFound("关联订单不存在");
    if (order.buyerId !== input.userId && order.sellerId !== input.userId) {
      throw Errors.badRequest("处理对象不是关联订单参与者");
    }
  }
}

export async function createMarketViolation(
  actor: MarketGovernanceActor,
  input: MarketViolationCreateInput,
) {
  requireMarketGovernanceStaff(actor.role);
  if (input.expiresAt && input.expiresAt <= new Date()) {
    throw Errors.badRequest("限制结束时间必须晚于当前时间");
  }
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: input.userId },
      select: MARKET_PUBLIC_USER_SELECT,
    });
    if (!target) throw Errors.notFound("处理对象不存在");
    await validateViolationReference(tx, input);
    const violation = await tx.marketViolation.create({
      data: { ...input, createdById: actor.userId },
    });
    await awardTransactionPointsInTransaction(tx, {
      userId: input.userId,
      delta: violationPointPenalty(input.level),
      event: "market_violation",
      sourceType: "market_violation",
      sourceId: violation.id,
      reason: `市集违规：${input.reason}`,
    });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.violation.create",
      targetType: "user",
      targetId: target.id,
      summary: `记录市集违规：${target.nickname}`,
      detail: {
        violationId: violation.id,
        type: violation.type,
        level: violation.level,
        action: violation.action,
        reason: violation.reason,
        expiresAt: violation.expiresAt,
      },
      ip: actor.ip,
    });
    return { target, violation };
  });

  await notifyMarketUser(
    result.target.id,
    "市集账号收到处理提醒",
    `${result.violation.reason}${result.violation.expiresAt ? `；限制至 ${result.violation.expiresAt.toLocaleString("zh-CN")}` : ""}`,
    "/market/mine?tab=trust",
    {
      type: "market-violation",
      violationId: result.violation.id,
      action: result.violation.action,
    },
  );
  return result.violation;
}

export async function revokeMarketViolation(
  actor: MarketGovernanceActor,
  violationId: number,
  input: MarketViolationRevokeInput,
) {
  requireMarketGovernanceStaff(actor.role);
  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketGovernanceLock(tx, "violation", violationId);
    const current = await tx.marketViolation.findUnique({
      where: { id: violationId },
      include: { user: { select: MARKET_PUBLIC_USER_SELECT } },
    });
    if (!current) throw Errors.notFound("违规记录不存在");
    if (current.status !== "active") {
      throw Errors.badRequest("该违规记录当前不能撤销");
    }
    const changed = await tx.marketViolation.updateMany({
      where: { id: violationId, status: "active" },
      data: { status: "revoked", revokedAt: new Date() },
    });
    if (changed.count !== 1) {
      throw Errors.conflict("违规记录状态已变化，请刷新后重试");
    }
    const violation = await tx.marketViolation.findUniqueOrThrow({
      where: { id: violationId },
    });
    await restoreViolationPointsInTransaction(tx, {
      userId: current.userId,
      originalEvent: "market_violation",
      restoreEvent: "market_violation_restored",
      sourceType: "market_violation",
      sourceId: violationId,
      reason: input.note || "市集违规处理撤销，返还原扣积分",
    });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.violation.revoke",
      targetType: "user",
      targetId: current.userId,
      summary: `撤销市集处理：${current.user.nickname}`,
      detail: { violationId, note: input.note },
      ip: actor.ip,
    });
    return { current, violation };
  });

  await notifyMarketUser(
    result.current.userId,
    "市集账号处理已撤销",
    input.note || "管理员已撤销该条市集处理",
    "/market/mine?tab=trust",
    { type: "market-violation-revoked", violationId },
  );
  return result.violation;
}

export async function handleMarketAppeal(
  actor: MarketGovernanceActor,
  appealId: number,
  input: MarketAppealActionInput,
) {
  requireMarketGovernanceStaff(actor.role);
  const reference = await prisma.marketAppeal.findUnique({
    where: { id: appealId },
    select: { violationId: true },
  });
  if (!reference) throw Errors.notFound("申诉不存在");

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketGovernanceLock(tx, "violation", reference.violationId);
    const current = await tx.marketAppeal.findUnique({
      where: { id: appealId },
      include: {
        violation: true,
        user: { select: MARKET_PUBLIC_USER_SELECT },
      },
    });
    if (!current) throw Errors.notFound("申诉不存在");
    if (current.status !== "pending") throw Errors.conflict("该申诉已经处理");
    const changed = await tx.marketAppeal.updateMany({
      where: { id: appealId, status: "pending" },
      data: {
        status: input.status,
        handledById: actor.userId,
        handledNote: input.note,
        handledAt: new Date(),
      },
    });
    if (changed.count !== 1) {
      throw Errors.conflict("申诉状态已变化，请刷新后重试");
    }
    if (input.status === "approved") {
      await tx.marketViolation.update({
        where: { id: current.violationId },
        data: { status: "revoked", revokedAt: new Date() },
      });
      await restoreViolationPointsInTransaction(tx, {
        userId: current.userId,
        originalEvent: "market_violation",
        restoreEvent: "market_violation_restored",
        sourceType: "market_violation",
        sourceId: current.violationId,
        reason: "市集申诉通过，返还原扣积分",
      });
    }
    const appeal = await tx.marketAppeal.findUniqueOrThrow({
      where: { id: appealId },
    });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: `market.appeal.${input.status}`,
      targetType: "market_appeal",
      targetId: appealId,
      summary: `处理市集申诉：${current.user.nickname}`,
      detail: {
        violationId: current.violationId,
        status: input.status,
        note: input.note,
      },
      ip: actor.ip,
    });
    return { current, appeal };
  });

  await notifyMarketUser(
    result.current.userId,
    "市集申诉已有结果",
    `申诉结果：${input.status === "approved" ? "通过" : "未通过"}；${input.note}`,
    "/market/mine?tab=trust",
    {
      type: "market-appeal-result",
      appealId,
      status: input.status,
    },
  );
  return result.appeal;
}

export async function removeWantedForModerationInTransaction(
  tx: any,
  wantedPostId: number,
  note: string,
  acquireLock = true,
) {
  if (acquireLock) await acquireMarketWantedLock(tx, wantedPostId);
  const current = await tx.wantedPost.findUnique({
    where: { id: wantedPostId },
  });
  if (!current) throw Errors.notFound("求购不存在");
  const removed = await tx.wantedPost.update({
    where: { id: wantedPostId },
    data: {
      status: "removed",
      moderationNote: note,
      moderatedAt: new Date(),
    },
  });
  await closePendingWantedInterest(tx, wantedPostId);
  return removed;
}

export async function handleMarketReport(
  actor: MarketGovernanceActor,
  reportId: number,
  input: MarketAdminReportActionInput,
) {
  requireMarketGovernanceStaff(actor.role);
  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketGovernanceLock(tx, "reportRecord", reportId);
    const current = await tx.marketReport.findUnique({
      where: { id: reportId },
    });
    if (!current) throw Errors.notFound("举报不存在");
    if (current.status !== "pending") throw Errors.badRequest("该举报已经处理");

    let removedWanted: any = null;
    if (input.hideItem && current.itemId) {
      await hideMarketItemForReportInTransaction(
        tx,
        actor,
        current.itemId,
        input.note,
      );
    }
    if (input.hideItem && current.wantedPostId) {
      removedWanted = await removeWantedForModerationInTransaction(
        tx,
        current.wantedPostId,
        input.note,
      );
    }

    const changed = await tx.marketReport.updateMany({
      where: { id: reportId, status: "pending" },
      data: {
        status: input.status,
        handledById: actor.userId,
        handledNote: input.note,
        handledAt: new Date(),
      },
    });
    if (changed.count !== 1) {
      throw Errors.conflict("举报状态已变化，请刷新后重试");
    }
    const report = await tx.marketReport.findUniqueOrThrow({
      where: { id: reportId },
    });
    if (input.status === "resolved") {
      await awardTransactionPointsInTransaction(tx, {
        userId: report.reporterId,
        delta: TRANSACTION_POINT_RULES.validReport,
        event: "valid_report",
        sourceType: "market_report",
        sourceId: reportId,
      });
    }
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.report.handle",
      targetType: "market_report",
      targetId: reportId,
      summary: `处理市集举报：${report.type}`,
      detail: {
        status: input.status,
        hideTarget: input.hideItem,
        note: input.note,
      },
      ip: actor.ip,
    });
    return { report, removedWanted };
  });

  if (result.removedWanted) {
    await syncPersistedWantedDemandTopic(result.removedWanted);
  }
  const reportLink = result.report.itemId
    ? `/market/item/${result.report.itemId}`
    : result.report.wantedPostId
      ? `/market/wanted/${result.report.wantedPostId}`
      : "/market/mine?tab=trust";
  await notifyMarketUser(
    result.report.reporterId,
    "市集举报已处理",
    `你的举报已被标记为 ${input.status}${input.note ? `：${input.note}` : ""}`,
    reportLink,
    { type: "market-report-result", reportId },
  );
  return result.report;
}

export async function listMarketAdminActionLogs(
  actor: MarketGovernanceActor,
  page: number,
  size: number,
) {
  requireMarketGovernanceStaff(actor.role);
  const [total, list] = await Promise.all([
    prisma.adminActionLog.count(),
    prisma.adminActionLog.findMany({
      include: { actor: { select: MARKET_PUBLIC_USER_SELECT } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * size,
      take: size,
    }),
  ]);
  return { page, size, total, list };
}
