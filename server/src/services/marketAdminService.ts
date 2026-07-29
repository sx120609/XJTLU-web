import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { acquireMarketCategoryLock } from "./marketCategoryLockService";
import {
  ensureMarketCategories,
  getMarketConfig,
  itemInclude,
  serializeItem,
  serializeMarketConfig,
} from "./marketCatalogService";
import {
  removeWantedForModerationInTransaction,
} from "./marketGovernanceService";
import {
  marketItemAdminSchema,
  moderateMarketItemInTransaction,
} from "./marketItemWriteService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { nextWantedExpiry } from "./marketLifecycle";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { serializeMarketOrder } from "./marketOrderService";
import {
  STUDENT_MARKET_PAYMENT_ENABLED,
} from "./marketPolicy";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import { openMarketSensitive } from "./marketSensitiveService";
import { logMarketAdminAction } from "./marketTrust";
import { acquireMarketWantedLock } from "./marketWantedLockService";
import {
  closePendingWantedInterest,
  serializeWantedPost,
} from "./marketWantedService";
import { syncPersistedWantedDemandTopic } from "./wantedDemandTopic";

const MARKET_CONFIG_ID = 1;

export type MarketAdminActor = {
  userId: number;
  role: string;
  ip: string;
};

export const marketAdminConfigSchema = z.object({
  learningMaterialCommissionRate: z.literal(0),
}).strict();

export const marketCategoryCreateSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(1).max(30),
  icon: z.string().trim().min(1).max(12).default("📦"),
  description: z.string().trim().max(120).default(""),
  fulfillmentType: z.literal("physical").default("physical"),
  imageRequired: z.boolean().default(true),
  enabled: z.boolean().default(true),
  sort: z.number().int().min(0).max(9999).default(0),
}).strict();

export const marketCategoryPatchSchema = marketCategoryCreateSchema
  .omit({ slug: true })
  .partial()
  .strict();

export const marketAdminWantedSchema = z.object({
  status: z.enum(["reviewing", "active", "expired", "removed"]),
  note: z.string().trim().max(500).optional().default(""),
}).strict();

export const marketAdminRefundSchema = z.object({
  status: z.enum(["approved", "completed", "rejected", "failed"]),
  providerRefundNo: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional().default(""),
}).strict();

export const marketAdminSettlementSchema = z.object({
  status: z.enum(["available", "held", "settled"]),
  reference: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(500).optional().default(""),
}).strict();

export { marketItemAdminSchema };

type MarketCategoryCreateInput = z.infer<typeof marketCategoryCreateSchema>;
type MarketCategoryPatchInput = z.infer<typeof marketCategoryPatchSchema>;
type MarketAdminWantedInput = z.infer<typeof marketAdminWantedSchema>;
type MarketAdminRefundInput = z.infer<typeof marketAdminRefundSchema>;
type MarketAdminSettlementInput = z.infer<typeof marketAdminSettlementSchema>;

function requireMarketStaff(role: string) {
  if (!["admin", "mod"].includes(role)) {
    throw Errors.forbidden("需要市集管理权限");
  }
}

function requireMarketAdmin(role: string) {
  if (role !== "admin") throw Errors.forbidden("需要管理员权限");
}

function requireHistoricalPaymentsWritable() {
  if (!STUDENT_MARKET_PAYMENT_ENABLED) {
    throw Errors.forbidden("学生商品支付、退款与结算后台已冻结，仅保留历史记录只读查询");
  }
}

export function assertMarketRefundTransition(
  currentStatus: string,
  nextStatus: MarketAdminRefundInput["status"],
) {
  const transitions: Record<string, readonly string[]> = {
    pending: ["approved", "rejected", "failed"],
    approved: ["completed", "rejected", "failed"],
    failed: ["approved", "rejected"],
    completed: [],
    rejected: [],
  };
  if (!(transitions[currentStatus] || []).includes(nextStatus)) {
    throw Errors.conflict(`退款状态不能从 ${currentStatus} 调整为 ${nextStatus}`);
  }
}

export function assertMarketSettlementTransition(
  currentStatus: string,
  nextStatus: MarketAdminSettlementInput["status"],
) {
  const transitions: Record<string, readonly string[]> = {
    pending: ["available", "held"],
    available: ["held", "settled"],
    held: ["available", "settled"],
    settled: [],
  };
  if (!(transitions[currentStatus] || []).includes(nextStatus)) {
    throw Errors.conflict(`结算状态不能从 ${currentStatus} 调整为 ${nextStatus}`);
  }
}

export async function getMarketAdminConfig(role: string) {
  requireMarketAdmin(role);
  return serializeMarketConfig(await getMarketConfig());
}

export async function updateMarketAdminConfig(
  actor: MarketAdminActor,
) {
  requireMarketAdmin(actor.role);
  const config = await prisma.$transaction(async (tx) => {
    const updated = await tx.marketConfig.upsert({
      where: { id: MARKET_CONFIG_ID },
      update: {
        commissionBps: 0,
        learningMaterialCommissionBps: 0,
      },
      create: {
        id: MARKET_CONFIG_ID,
        commissionBps: 0,
        learningMaterialCommissionBps: 0,
      },
    });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.config.update",
      targetType: "market_config",
      targetId: MARKET_CONFIG_ID,
      summary: "更新市集费率配置",
      detail: {
        commissionBps: 0,
        learningMaterialCommissionBps: 0,
      },
      ip: actor.ip,
    });
    return updated;
  });
  return serializeMarketConfig(config);
}

export async function listMarketAdminCategories(role: string) {
  requireMarketAdmin(role);
  await ensureMarketCategories();
  const [list, counts] = await Promise.all([
    prisma.marketCategory.findMany({
      orderBy: [{ sort: "asc" }, { id: "asc" }],
    }),
    prisma.marketItem.groupBy({
      by: ["category"],
      _count: { _all: true },
    }),
  ]);
  const countMap = new Map(
    counts.map((row) => [row.category, row._count._all]),
  );
  return list.map((category) => ({
    ...category,
    itemCount: countMap.get(category.slug) || 0,
  }));
}

export async function createMarketAdminCategory(
  actor: MarketAdminActor,
  input: MarketCategoryCreateInput,
) {
  requireMarketAdmin(actor.role);
  return prisma.$transaction(async (tx) => {
    await acquireMarketCategoryLock(tx, input.slug);
    const existing = await tx.marketCategory.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (existing) throw Errors.conflict("品类标识已存在");
    const category = await tx.marketCategory.create({ data: input });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.category.create",
      targetType: "market_category",
      targetId: category.id,
      summary: `新增市集品类：${category.name}`,
      detail: { slug: category.slug },
      ip: actor.ip,
    });
    return { ...category, itemCount: 0 };
  });
}

export async function updateMarketAdminCategory(
  actor: MarketAdminActor,
  categoryId: number,
  input: MarketCategoryPatchInput,
) {
  requireMarketAdmin(actor.role);
  const reference = await prisma.marketCategory.findUnique({
    where: { id: categoryId },
    select: { slug: true },
  });
  if (!reference) throw Errors.notFound("品类不存在");
  return prisma.$transaction(async (tx) => {
    await acquireMarketCategoryLock(tx, reference.slug);
    const current = await tx.marketCategory.findUnique({
      where: { id: categoryId },
    });
    if (!current) throw Errors.notFound("品类不存在");
    if (current.fulfillmentType === "digital") {
      throw Errors.forbidden("历史数字品类已冻结，不能修改或重新启用");
    }
    const category = await tx.marketCategory.update({
      where: { id: categoryId },
      data: input,
    });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.category.update",
      targetType: "market_category",
      targetId: categoryId,
      summary: `更新市集品类：${category.name}`,
      detail: input,
      ip: actor.ip,
    });
    return category;
  });
}

export async function deleteMarketAdminCategory(
  actor: MarketAdminActor,
  categoryId: number,
) {
  requireMarketAdmin(actor.role);
  const reference = await prisma.marketCategory.findUnique({
    where: { id: categoryId },
    select: { slug: true },
  });
  if (!reference) throw Errors.notFound("品类不存在");
  return prisma.$transaction(async (tx) => {
    await acquireMarketCategoryLock(tx, reference.slug);
    const category = await tx.marketCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) throw Errors.notFound("品类不存在");
    if (category.fulfillmentType === "digital") {
      throw Errors.forbidden("历史数字品类已冻结，不能删除");
    }
    const itemCount = await tx.marketItem.count({
      where: { category: category.slug },
    });
    if (itemCount) {
      throw Errors.conflict("该品类下已有商品，请停用品类，不能直接删除");
    }
    await tx.marketCategory.delete({ where: { id: categoryId } });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.category.delete",
      targetType: "market_category",
      targetId: categoryId,
      summary: `删除市集品类：${category.name}`,
      detail: { slug: category.slug },
      ip: actor.ip,
    });
    return { ok: true as const };
  });
}

export async function getMarketAdminOverview(role: string) {
  requireMarketStaff(role);
  const statuses = [
    "reviewing",
    "active",
    "reserved",
    "sold",
    "expired",
    "hidden",
  ];
  const [
    counts,
    reports,
    refunds,
    settlements,
    orders,
    reviewItems,
    expiredItems,
    wantedModeration,
    safetyRules,
    violations,
    appeals,
    actionLogs,
  ] = await Promise.all([
    Promise.all(statuses.map(async (status) => [
      status,
      await prisma.marketItem.count({
        where: { status, visibility: "public" },
      }),
    ])),
    prisma.marketReport.findMany({
      include: {
        item: { select: { id: true, title: true, status: true } },
        wantedPost: { select: { id: true, title: true, status: true } },
        order: { select: { id: true, outTradeNo: true, status: true } },
        reportedUser: { select: MARKET_PUBLIC_USER_SELECT },
        reporter: { select: MARKET_PUBLIC_USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.marketRefund.findMany({
      include: {
        order: {
          include: {
            item: { select: { id: true, title: true } },
            buyer: { select: MARKET_PUBLIC_USER_SELECT },
            seller: { select: MARKET_PUBLIC_USER_SELECT },
          },
        },
        requestedBy: { select: MARKET_PUBLIC_USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.marketSettlement.findMany({
      include: {
        order: { include: { item: { select: { id: true, title: true } } } },
        seller: { select: MARKET_PUBLIC_USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.marketOrder.findMany({
      include: {
        item: { select: { id: true, title: true } },
        buyer: { select: MARKET_PUBLIC_USER_SELECT },
        seller: { select: MARKET_PUBLIC_USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.marketItem.findMany({
      where: { status: "reviewing", visibility: "public" },
      include: itemInclude,
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.marketItem.findMany({
      where: { status: "expired", visibility: "public" },
      include: itemInclude,
      orderBy: { expiresAt: "desc" },
      take: 100,
    }),
    prisma.wantedPost.findMany({
      where: { status: { in: ["reviewing", "expired", "removed"] } },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        _count: { select: { responses: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.marketSafetyRule.findMany({
      include: { createdBy: { select: MARKET_PUBLIC_USER_SELECT } },
      orderBy: [{ enabled: "desc" }, { id: "asc" }],
    }),
    prisma.marketViolation.findMany({
      include: {
        user: { select: MARKET_PUBLIC_USER_SELECT },
        createdBy: { select: MARKET_PUBLIC_USER_SELECT },
        item: { select: { id: true, title: true } },
        wantedPost: { select: { id: true, title: true } },
        order: { select: { id: true, outTradeNo: true } },
        _count: { select: { appeals: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.marketAppeal.findMany({
      include: {
        user: { select: MARKET_PUBLIC_USER_SELECT },
        violation: true,
        handledBy: { select: MARKET_PUBLIC_USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.adminActionLog.findMany({
      include: { actor: { select: MARKET_PUBLIC_USER_SELECT } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    counts: Object.fromEntries(counts),
    reports,
    refunds: refunds.map((refund) => ({
      ...refund,
      amount: amountCentsToMoney(refund.amountCents),
      order: serializeMarketOrder(refund.order),
    })),
    settlements: settlements.map((settlement) => ({
      ...settlement,
      amount: amountCentsToMoney(settlement.amountCents),
      order: serializeMarketOrder(settlement.order),
    })),
    orders: orders.map((order) => serializeMarketOrder(order)),
    reviewItems: reviewItems.map((item) => serializeItem(item)),
    expiredItems: expiredItems.map((item) => serializeItem(item)),
    wantedModeration: wantedModeration.map((post) => serializeWantedPost(post)),
    safetyRules,
    violations,
    appeals,
    actionLogs,
  };
}

export async function moderateMarketAdminItem(
  actor: MarketAdminActor,
  itemId: number,
  input: z.infer<typeof marketItemAdminSchema>,
) {
  requireMarketStaff(actor.role);
  const item = await prisma.$transaction(async (tx) => {
    const updated = await moderateMarketItemInTransaction(
      tx,
      actor,
      itemId,
      input,
    );
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.item.moderate",
      targetType: "market_item",
      targetId: itemId,
      summary: `调整商品状态：${updated.title}`,
      detail: { status: input.status, note: input.note },
      ip: actor.ip,
    });
    return updated;
  });
  await notifyMarketUser(
    item.sellerId,
    "商品状态已更新",
    `「${item.title}」已被管理员调整为 ${input.status}${input.note ? `：${input.note}` : ""}`,
    `/market/item/${itemId}`,
    {
      type: "market-admin-item",
      itemId,
      status: input.status,
    },
  );
  return serializeItem(item);
}

export async function moderateMarketAdminWanted(
  actor: MarketAdminActor,
  wantedPostId: number,
  input: MarketAdminWantedInput,
) {
  requireMarketStaff(actor.role);
  const post = await prisma.$transaction(async (tx) => {
    await acquireMarketWantedLock(tx, wantedPostId);
    const current = await tx.wantedPost.findUnique({
      where: { id: wantedPostId },
    });
    if (!current) throw Errors.notFound("求购不存在");
    if (!["reviewing", "active", "expired", "removed"].includes(current.status)) {
      throw Errors.conflict("该求购已进入交易或终态，不能通过审核后台覆盖");
    }
    if (current.status === input.status) {
      throw Errors.conflict("求购已经是该状态");
    }
    if (input.status === "removed") {
      await removeWantedForModerationInTransaction(
        tx,
        wantedPostId,
        input.note,
        false,
      );
    } else {
      await tx.wantedPost.update({
        where: { id: wantedPostId },
        data: {
          status: input.status,
          moderationNote: input.note,
          moderatedAt: new Date(),
          expiresAt: input.status === "active"
            ? nextWantedExpiry()
            : undefined,
        },
      });
      if (input.status !== "active") {
        await closePendingWantedInterest(tx, wantedPostId);
      }
    }
    const updated = await tx.wantedPost.findUnique({
      where: { id: wantedPostId },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        _count: { select: { responses: true } },
      },
    });
    if (!updated) throw Errors.notFound("求购不存在");
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.wanted.moderate",
      targetType: "wanted_post",
      targetId: wantedPostId,
      summary: `调整求购状态：${updated.title}`,
      detail: { status: input.status, note: input.note },
      ip: actor.ip,
    });
    return updated;
  });
  const topic = await syncPersistedWantedDemandTopic(post);
  await notifyMarketUser(
    post.authorId,
    "求购状态已更新",
    `「${post.title}」已被管理员调整为 ${input.status}${input.note ? `：${input.note}` : ""}`,
    `/forum/topic/${topic.id}`,
    {
      type: "market-admin-wanted",
      wantedPostId,
      topicId: topic.id,
      status: input.status,
    },
  );
  return serializeWantedPost(
    { ...post, topicId: topic.id },
    post.authorId,
  );
}

export async function handleMarketAdminRefund(
  actor: MarketAdminActor,
  refundId: number,
  input: MarketAdminRefundInput,
) {
  requireMarketAdmin(actor.role);
  requireHistoricalPaymentsWritable();
  const reference = await prisma.marketRefund.findUnique({
    where: { id: refundId },
    select: { orderId: true },
  });
  if (!reference) throw Errors.notFound("退款申请不存在");
  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, reference.orderId);
    const current = await tx.marketRefund.findUnique({
      where: { id: refundId },
      include: { order: { include: { item: true } } },
    });
    if (!current) throw Errors.notFound("退款申请不存在");
    assertMarketRefundTransition(current.status, input.status);
    if (!["refund_pending", "disputed"].includes(current.order.status)) {
      throw Errors.conflict("订单当前不在退款或争议处理中");
    }
    if (input.status === "completed") {
      await acquireMarketItemLock(tx, current.order.itemId);
    }
    const updated = await tx.marketRefund.update({
      where: { id: refundId },
      data: {
        status: input.status,
        providerRefundNo: input.providerRefundNo
          || current.providerRefundNo,
        handledById: actor.userId,
        handledNote: input.note,
        handledAt: new Date(),
      },
    });
    if (input.status === "completed") {
      await tx.marketOrder.update({
        where: { id: current.orderId },
        data: { status: "refunded", refundedAt: new Date() },
      });
      await tx.marketItem.updateMany({
        where: {
          id: current.order.itemId,
          status: { not: "hidden" },
        },
        data: { status: "active" },
      });
      await tx.learningMaterialAccess.updateMany({
        where: { orderId: current.orderId },
        data: { revokedAt: new Date() },
      });
    } else if (
      ["rejected", "failed"].includes(input.status)
      && current.order.status === "refund_pending"
    ) {
      await tx.marketOrder.update({
        where: { id: current.orderId },
        data: {
          status: current.order.deliveryType === "digital"
            ? "delivering"
            : "paid",
        },
      });
    }
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.refund.handle",
      targetType: "market_refund",
      targetId: refundId,
      summary: `处理退款申请：${input.status}`,
      detail: { status: input.status, note: input.note },
      ip: actor.ip,
    });
    return { current, updated };
  });
  await notifyMarketUser(
    result.current.order.buyerId,
    "退款状态已更新",
    `「${result.current.order.item.title}」退款申请：${input.status}${input.note ? `：${input.note}` : ""}`,
    "/market/mine?tab=orders",
    {
      type: "market-refund-result",
      orderId: result.current.orderId,
      refundId,
    },
  );
  return result.updated;
}

export async function handleMarketAdminSettlement(
  actor: MarketAdminActor,
  settlementId: number,
  input: MarketAdminSettlementInput,
) {
  requireMarketAdmin(actor.role);
  requireHistoricalPaymentsWritable();
  const reference = await prisma.marketSettlement.findUnique({
    where: { id: settlementId },
    select: { orderId: true },
  });
  if (!reference) throw Errors.notFound("结算单不存在");
  const settlement = await prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, reference.orderId);
    const current = await tx.marketSettlement.findUnique({
      where: { id: settlementId },
      include: {
        order: {
          include: {
            item: true,
            learningMaterialSupport: true,
            refunds: {
              where: { status: { in: ["pending", "approved"] } },
              select: { id: true },
            },
          },
        },
      },
    });
    if (!current) throw Errors.notFound("结算单不存在");
    assertMarketSettlementTransition(current.status, input.status);
    if (input.status === "settled") {
      if (current.order.status !== "completed") {
        throw Errors.conflict("订单尚未完成，不能结算");
      }
      if (current.order.refunds.length) {
        throw Errors.conflict("订单存在进行中的退款，不能结算");
      }
      if (
        current.order.learningMaterialSupport
        && !["resolved", "closed"].includes(
          current.order.learningMaterialSupport.status,
        )
      ) {
        throw Errors.conflict("订单存在未解决的售后服务单，不能结算");
      }
    }
    const updated = await tx.marketSettlement.update({
      where: { id: settlementId },
      data: {
        status: input.status,
        reference: input.reference,
        note: input.note,
        settledAt: input.status === "settled" ? new Date() : null,
      },
      include: { order: { include: { item: true } } },
    });
    await logMarketAdminAction(tx, {
      actorId: actor.userId,
      action: "market.settlement.handle",
      targetType: "market_settlement",
      targetId: settlementId,
      summary: `处理市集结算：${input.status}`,
      detail: { status: input.status, note: input.note },
      ip: actor.ip,
    });
    return updated;
  });
  await notifyMarketUser(
    settlement.sellerId,
    "市集结算状态已更新",
    `「${settlement.order.item.title}」结算状态：${input.status}`,
    "/market/mine?tab=selling",
    {
      type: "market-settlement",
      settlementId,
      orderId: settlement.orderId,
    },
  );
  return {
    ...settlement,
    amount: amountCentsToMoney(settlement.amountCents),
  };
}

export async function getMarketAdminPayoutProfile(
  actor: MarketAdminActor,
  settlementId: number,
) {
  requireMarketAdmin(actor.role);
  requireHistoricalPaymentsWritable();
  const settlement = await prisma.marketSettlement.findUnique({
    where: { id: settlementId },
    include: {
      seller: { include: { marketPayoutProfile: true } },
    },
  });
  if (!settlement) throw Errors.notFound("结算单不存在");
  const profile = settlement.seller.marketPayoutProfile;
  if (!profile) throw Errors.notFound("卖家尚未设置收款资料");
  return {
    method: profile.method,
    account: openMarketSensitive(profile.accountEncrypted),
    realName: openMarketSensitive(profile.realNameEncrypted),
    verified: profile.verified,
  };
}
