import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import {
  categoryBelongsToCatalog,
  isLearningMaterialCategory,
} from "./marketCatalog";
import { requireVerifiedMarketUser } from "./marketAccessService";
import {
  cents,
  ensureMarketCategories,
  getMarketCategory,
  ITEM_CONDITIONS,
  itemInclude,
  LISTING_TYPES,
  normalizeMarketTradeMode,
  serializeItem,
  TRADE_MODES,
} from "./marketCatalogService";
import {
  MARKET_CAMPUSES,
  normalizeMarketCampus,
} from "./marketCampus";
import { amountCentsToMoney } from "./epay";
import { acquireMarketItemLock } from "./marketItemLockService";
import { acquireMarketCategoryLock } from "./marketCategoryLockService";
import { notifyMatchesForItem } from "./marketMatching";
import { evaluateMarketContent } from "./marketTrust";
import {
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
} from "./topicAiReview";
import { ensureUserCanSpeak } from "./userModeration";

export const MARKET_ITEM_STATUSES = [
  "draft",
  "reviewing",
  "active",
  "negotiating",
  "reserved",
  "sold",
  "withdrawn",
  "expired",
  "hidden",
  "targeted",
] as const;

const SELLER_EDITABLE_ITEM_STATUSES = [
  "draft",
  "reviewing",
  "active",
  "expired",
  "withdrawn",
  "sold",
] as const;

const SELLER_ITEM_TARGET_STATUSES = [
  "active",
  "withdrawn",
  "sold",
  "draft",
] as const;

const ACTIVE_MARKET_ORDER_STATUSES = [
  "negotiating",
  "pending_payment",
  "reserved",
  "paid",
  "delivering",
  "refund_pending",
  "disputed",
] as const;

const imageUrlSchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  "图片地址格式不正确",
);

const optionalMarketCampusSchema = z.preprocess(
  normalizeMarketCampus,
  z.union([z.enum(MARKET_CAMPUSES), z.literal("")]),
);

const marketTradeModeSchema = z.preprocess(
  normalizeMarketTradeMode,
  z.enum(TRADE_MODES),
);

export const marketItemInputSchema = z.object({
  catalog: z.enum(["market", "learning_materials"]).default("market"),
  listingType: z.enum(LISTING_TYPES).default("sell"),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(20000),
  category: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  price: z.union([z.string(), z.number()]),
  originalPrice: z.union([z.string(), z.number()]).optional().nullable(),
  negotiable: z.boolean().optional().default(false),
  condition: z.enum(ITEM_CONDITIONS),
  tradeMode: marketTradeModeSchema,
  campus: optionalMarketCampusSchema.optional().default(""),
  location: z.string().trim().max(100).optional().default(""),
  brand: z.string().trim().max(80).optional().default(""),
  model: z.string().trim().max(80).optional().default(""),
  usageDuration: z.string().trim().max(80).optional().default(""),
  flaws: z.string().trim().max(1000).optional().default(""),
  accessories: z.string().trim().max(500).optional().default(""),
  testAllowed: z.boolean().optional().default(true),
  availableTime: z.string().trim().max(500).optional().default(""),
  images: z.array(imageUrlSchema).max(9).optional().default([]),
  digitalDelivery: z.string().trim().max(10000).optional().default(""),
  draft: z.boolean().optional().default(false),
});

export const marketItemPatchSchema = marketItemInputSchema.partial().extend({
  status: z.enum(SELLER_ITEM_TARGET_STATUSES).optional(),
});

export const marketItemLifecycleSchema = z.object({
  action: z.enum(["renew", "withdraw", "mark_sold", "relist"]),
});

export const marketItemAdminSchema = z.object({
  status: z.enum(MARKET_ITEM_STATUSES),
  note: z.string().trim().max(500).optional().default(""),
}).strict();

export type MarketItemInput = z.infer<typeof marketItemInputSchema>;
export type MarketItemPatch = z.infer<typeof marketItemPatchSchema>;
export type MarketItemLifecycleAction = z.infer<typeof marketItemLifecycleSchema>["action"];
export type MarketItemAdminInput = z.infer<typeof marketItemAdminSchema>;

export type MarketItemActor = {
  userId: number;
  role: string;
};

export function isMarketItemStaff(role: string) {
  return role === "admin" || role === "mod";
}

export function canManageMarketItem(sellerId: number, actor: MarketItemActor) {
  return sellerId === actor.userId || isMarketItemStaff(actor.role);
}

export function marketItemStatusClosesPendingInterest(status: string) {
  return !["active", "negotiating"].includes(status);
}

async function closePendingMarketItemInterest(tx: any, itemId: number) {
  await tx.marketOrder.updateMany({
    where: { itemId, status: "negotiating" },
    data: {
      status: "cancelled",
      closedAt: new Date(),
      cancelReason: "商品已由卖家结束交易",
      expiresAt: null,
    },
  });
  await tx.tradeIntent.updateMany({
    where: { itemId, status: "pending" },
    data: { status: "expired" },
  });
  await tx.marketOffer.updateMany({
    where: { itemId, status: "pending" },
    data: { status: "rejected" },
  });
  await tx.wantedResponse.updateMany({
    where: { itemId, status: "pending" },
    data: { status: "expired" },
  });
}

async function findActiveMarketItemOrder(tx: any, itemId: number) {
  return tx.marketOrder.findFirst({
    where: {
      itemId,
      status: { in: [...ACTIVE_MARKET_ORDER_STATUSES] },
    },
    select: { id: true },
  });
}

function ensureOrdinaryPhysicalItem(item: {
  category: string;
  deliveryType: string;
}) {
  if (isLearningMaterialCategory(item.category) || item.deliveryType !== "physical") {
    throw Errors.badRequest("学习资料必须通过靠浦特色学习资料专属接口修改");
  }
}

async function getTransactionMarketCategory(
  tx: any,
  slug: string,
  includeDisabled: boolean,
) {
  const category = await tx.marketCategory.findUnique({ where: { slug } });
  if (!category || (!includeDisabled && !category.enabled)) {
    throw Errors.badRequest("请选择有效的商品品类");
  }
  if (category.fulfillmentType !== "physical") {
    throw Errors.badRequest("数字商品交易已关闭，历史记录只能保留查看");
  }
  return category;
}

function safetyFields(item: {
  title: string;
  description: string;
  brand: string;
  model: string;
  flaws: string;
  location: string;
}) {
  return [
    item.title,
    item.description,
    item.brand,
    item.model,
    item.flaws,
    item.location,
  ];
}

async function notifyIfActivated(itemId: number) {
  await notifyMatchesForItem(itemId)
    .catch((error) => console.warn("[market] item matching notification failed", error));
}

export async function createMarketItem(
  actor: MarketItemActor,
  input: MarketItemInput,
) {
  const userId = actor.userId;
  await requireVerifiedMarketUser(userId, actor.role, "publish");
  await ensureUserCanSpeak(userId);
  if (input.listingType !== "sell") {
    throw Errors.badRequest("求购请使用独立求购发布入口");
  }
  if (
    input.catalog === "learning_materials"
    || isLearningMaterialCategory(input.category)
  ) {
    throw Errors.badRequest("学习资料必须通过靠浦特色学习资料专属发布接口创建");
  }
  if (!categoryBelongsToCatalog(input.catalog, input.category)) {
    throw Errors.badRequest(
      input.catalog === "market"
        ? "电子资料请从靠浦特色学习资料发布"
        : "学习资料只能发布到靠浦特色学习资料",
    );
  }
  const category = await getMarketCategory(input.category);
  if (category.fulfillmentType !== "physical") {
    throw Errors.badRequest("第一阶段市集只支持实体物品和线下服务撮合，不支持数字商品交易");
  }
  if (category.imageRequired && !input.draft && !input.images.length) {
    throw Errors.badRequest("该品类出售商品时必须上传至少一张图片");
  }

  const priceCents = cents(input.price) ?? 0;
  const originalPriceCents = cents(input.originalPrice);
  const safety = await evaluateMarketContent(
    prisma,
    [input.title, input.description, input.brand, input.model, input.flaws, input.location],
  );
  if (safety.action === "block") {
    throw Errors.badRequest("商品内容包含市集禁售或高风险信息，请修改后再发布");
  }

  const metadata = {
    marketItem: true,
    price: Number(amountCentsToMoney(priceCents)),
    condition: input.condition,
    tradeMode: input.tradeMode,
    deliveryType: "physical",
    listingType: input.listingType,
    category: input.category,
    campus: input.campus,
    location: input.location,
    brand: input.brand,
    model: input.model,
    usageDuration: input.usageDuration,
    flaws: input.flaws,
    accessories: input.accessories,
    testAllowed: input.testAllowed,
    availableTime: input.availableTime,
    images: input.images,
  };
  const bypass = await shouldBypassAiReviewForUser(userId, actor.role);
  const review = shouldRunAiReview() && !bypass
    ? await reviewTopicContent({
      title: input.title,
      content: input.description,
      boardName: "校园市集",
      boardType: "market",
      metadata,
    })
    : null;
  const hiddenByReview = safety.action === "review" || review?.status === "blocked_ai";
  const item = await prisma.$transaction(async (tx) => {
    await acquireMarketCategoryLock(tx, input.category);
    const lockedCategory = await getTransactionMarketCategory(
      tx,
      input.category,
      false,
    );
    if (
      lockedCategory.imageRequired
      && !input.draft
      && !input.images.length
    ) {
      throw Errors.badRequest("该品类出售商品时必须上传至少一张图片");
    }
    return tx.marketItem.create({
      data: {
      sellerId: userId,
      listingType: input.listingType,
      title: input.title,
      description: input.description,
      category: input.category,
      deliveryType: "physical",
      digitalDeliveryEncrypted: null,
      priceCents,
      originalPriceCents,
      negotiable: input.negotiable,
      condition: input.condition,
      tradeMode: input.tradeMode,
      campus: input.campus,
      location: input.location,
      brand: input.brand,
      model: input.model,
      usageDuration: input.usageDuration,
      flaws: input.flaws,
      accessories: input.accessories,
      testAllowed: input.testAllowed,
      availableTime: input.availableTime,
      expiresAt: null,
      visibility: "public",
      status: input.draft ? "draft" : hiddenByReview ? "reviewing" : "active",
      moderationNote: safety.action === "review"
        ? (safety.matches[0]?.note || "市集规则命中人工复核")
        : review?.status === "blocked_ai" ? review.reason : "",
      images: {
        create: input.images.map((url, sort) => ({ url, sort })),
      },
      },
      include: itemInclude,
    });
  });
  if (item.status === "active") await notifyIfActivated(item.id);
  return {
    ...serializeItem(item, userId),
    review: review ? { status: review.status, reason: review.reason } : null,
    safetyReview: safety.action === "review"
      ? { status: "reviewing", reason: "公开内容包含联系方式或需人工复核的信息" }
      : null,
  };
}

export async function updateMarketItem(
  actor: MarketItemActor,
  itemId: number,
  input: MarketItemPatch,
) {
  const reference = await prisma.marketItem.findUnique({
    where: { id: itemId },
    select: { sellerId: true },
  });
  if (!reference) throw Errors.notFound("商品不存在");
  if (!canManageMarketItem(reference.sellerId, actor)) {
    throw Errors.forbidden("无权修改该商品");
  }
  if (!isMarketItemStaff(actor.role)) {
    await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  }
  await ensureMarketCategories();

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, itemId);
    const current = await tx.marketItem.findUnique({
      where: { id: itemId },
      include: { images: true },
    });
    if (!current) throw Errors.notFound("商品不存在");
    if (!canManageMarketItem(current.sellerId, actor)) {
      throw Errors.forbidden("无权修改该商品");
    }
    ensureOrdinaryPhysicalItem(current);

    const staff = isMarketItemStaff(actor.role);
    if (
      !staff
      && !(SELLER_EDITABLE_ITEM_STATUSES as readonly string[]).includes(current.status)
    ) {
      throw Errors.conflict("商品存在进行中的交易或当前状态不能编辑");
    }
    if (
      input.status
      && !staff
      && !(SELLER_ITEM_TARGET_STATUSES as readonly string[]).includes(input.status)
    ) {
      throw Errors.forbidden("不能切换到该商品状态");
    }
    if (await findActiveMarketItemOrder(tx, itemId)) {
      throw Errors.conflict("商品存在进行中的订单，不能通过编辑修改交易状态");
    }

    const finalCategory = input.category ?? current.category;
    if (
      isLearningMaterialCategory(current.category)
      || isLearningMaterialCategory(finalCategory)
    ) {
      throw Errors.badRequest("学习资料必须通过靠浦特色学习资料专属编辑接口修改");
    }
    const catalogScope = input.catalog ?? "market";
    if (!categoryBelongsToCatalog(catalogScope, finalCategory)) {
      throw Errors.badRequest(
        catalogScope === "market"
          ? "电子资料请从靠浦特色学习资料编辑"
          : "该商品不属于靠浦特色学习资料",
      );
    }
    await acquireMarketCategoryLock(tx, finalCategory);
    const category = await getTransactionMarketCategory(
      tx,
      finalCategory,
      Boolean(!input.category),
    );
    const finalListingType = input.listingType ?? current.listingType;
    if (finalListingType !== "sell") {
      throw Errors.badRequest("历史求购请迁移到独立求购系统后再编辑");
    }
    const requestedStatus = input.status
      ?? (input.draft === undefined ? current.status : input.draft ? "draft" : "active");
    const finalImageCount = input.images ? input.images.length : current.images.length;
    if (
      category.imageRequired
      && requestedStatus === "active"
      && finalImageCount === 0
    ) {
      throw Errors.badRequest("该品类出售商品时必须上传至少一张图片");
    }

    const nextContent = {
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      brand: input.brand ?? current.brand,
      model: input.model ?? current.model,
      flaws: input.flaws ?? current.flaws,
      location: input.location ?? current.location,
    };
    const safety = await evaluateMarketContent(tx, safetyFields(nextContent));
    if (safety.action === "block") {
      throw Errors.badRequest("商品内容包含市集禁售或高风险信息，请修改后再发布");
    }
    const nextStatus = safety.action === "review" && requestedStatus === "active"
      ? "reviewing"
      : requestedStatus;
    const data: any = { ...input };
    delete data.catalog;
    delete data.images;
    delete data.price;
    delete data.originalPrice;
    delete data.draft;
    delete data.digitalDelivery;
    data.deliveryType = "physical";
    data.digitalDeliveryEncrypted = null;
    data.status = nextStatus;
    data.expiresAt = null;
    if (input.price !== undefined) data.priceCents = cents(input.price) ?? 0;
    if (input.originalPrice !== undefined) {
      data.originalPriceCents = cents(input.originalPrice);
    }
    if (nextStatus === "sold") {
      data.soldAt = current.status === "sold" && current.soldAt
        ? current.soldAt
        : new Date();
    } else if (nextStatus !== current.status || input.status !== undefined || input.draft !== undefined) {
      data.soldAt = null;
    }
    if (safety.action === "review" && requestedStatus === "active") {
      data.moderationNote = safety.matches[0]?.note || "市集规则命中人工复核";
    }

    if (input.images) {
      await tx.marketImage.deleteMany({ where: { itemId } });
      if (input.images.length) {
        await tx.marketImage.createMany({
          data: input.images.map((url, sort) => ({ itemId, url, sort })),
        });
      }
    }
    const updated = await tx.marketItem.update({
      where: { id: itemId },
      data,
      include: itemInclude,
    });
    if (marketItemStatusClosesPendingInterest(nextStatus)) {
      await closePendingMarketItemInterest(tx, itemId);
    }
    return {
      item: updated,
      activated: current.status !== "active" && updated.status === "active",
    };
  });

  if (result.activated) await notifyIfActivated(itemId);
  return serializeItem(result.item, actor.userId);
}

export async function transitionMarketItemLifecycle(
  actor: MarketItemActor,
  itemId: number,
  action: MarketItemLifecycleAction,
) {
  const reference = await prisma.marketItem.findUnique({
    where: { id: itemId },
    select: { sellerId: true },
  });
  if (!reference) throw Errors.notFound("商品不存在");
  if (!canManageMarketItem(reference.sellerId, actor)) throw Errors.forbidden();
  if (
    (action === "renew" || action === "relist")
    && !isMarketItemStaff(actor.role)
  ) {
    await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  }

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, itemId);
    const current = await tx.marketItem.findUnique({ where: { id: itemId } });
    if (!current) throw Errors.notFound("商品不存在");
    if (!canManageMarketItem(current.sellerId, actor)) throw Errors.forbidden();
    ensureOrdinaryPhysicalItem(current);
    if (current.visibility !== "public") {
      throw Errors.badRequest("该商品不能执行此操作");
    }

    let data: any;
    if (action === "renew" || action === "relist") {
      if (!["active", "expired", "withdrawn", "sold"].includes(current.status)) {
        throw Errors.badRequest("当前状态不能续期或重新上架");
      }
      const safety = await evaluateMarketContent(tx, safetyFields(current));
      if (safety.action === "block") {
        throw Errors.badRequest("商品内容包含市集禁售或高风险信息，请编辑后再上架");
      }
      data = {
        status: safety.action === "review" ? "reviewing" : "active",
        expiresAt: null,
        renewedAt: new Date(),
        soldAt: null,
        ...(safety.action === "review"
          ? { moderationNote: safety.matches[0]?.note || "市集规则命中人工复核" }
          : {}),
      };
    } else if (action === "withdraw") {
      if (!["active", "negotiating", "expired"].includes(current.status)) {
        throw Errors.badRequest("当前状态不能下架");
      }
      data = { status: "withdrawn" };
    } else {
      if (!["active", "negotiating", "expired", "withdrawn"].includes(current.status)) {
        throw Errors.badRequest("当前状态不能标记为已售");
      }
      data = { status: "sold", soldAt: new Date() };
    }

    const updated = await tx.marketItem.update({
      where: { id: itemId },
      data,
      include: itemInclude,
    });
    if (marketItemStatusClosesPendingInterest(updated.status)) {
      await closePendingMarketItemInterest(tx, itemId);
    }
    return {
      item: updated,
      activated: current.status !== "active" && updated.status === "active",
    };
  });

  if (result.activated) await notifyIfActivated(itemId);
  return serializeItem(result.item, actor.userId);
}

export async function withdrawMarketItemCompatibility(
  actor: MarketItemActor,
  itemId: number,
) {
  await prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, itemId);
    const current = await tx.marketItem.findUnique({ where: { id: itemId } });
    if (!current) throw Errors.notFound("商品不存在");
    if (!canManageMarketItem(current.sellerId, actor)) throw Errors.forbidden();
    ensureOrdinaryPhysicalItem(current);
    if (await findActiveMarketItemOrder(tx, itemId)) {
      throw Errors.conflict("商品存在进行中的订单，请先处理订单，不能直接删除");
    }
    await tx.marketItem.update({
      where: { id: itemId },
      data: { status: "withdrawn" },
    });
    await closePendingMarketItemInterest(tx, itemId);
  });
  return { ok: true as const };
}

export async function moderateMarketItemInTransaction(
  tx: any,
  actor: MarketItemActor,
  itemId: number,
  input: MarketItemAdminInput,
  acquireLock = true,
) {
  if (!isMarketItemStaff(actor.role)) throw Errors.forbidden("需要管理员权限");
  if (acquireLock) await acquireMarketItemLock(tx, itemId);
  const current = await tx.marketItem.findUnique({ where: { id: itemId } });
  if (!current) throw Errors.notFound("商品不存在");
  const activeOrder = await findActiveMarketItemOrder(tx, itemId);
  if (activeOrder && input.status !== "hidden") {
    throw Errors.conflict("商品存在进行中的订单，只能先隐藏，不能覆盖交易状态");
  }
  const updated = await tx.marketItem.update({
    where: { id: itemId },
    data: {
      status: input.status,
      soldAt: input.status === "sold"
        ? (current.soldAt || new Date())
        : input.status === "active" ? null : current.soldAt,
      moderationNote: input.note,
      moderatedAt: new Date(),
      expiresAt: input.status === "active" ? null : undefined,
    },
    include: itemInclude,
  });
  if (marketItemStatusClosesPendingInterest(updated.status)) {
    await closePendingMarketItemInterest(tx, itemId);
  }
  return updated;
}

export async function moderateMarketItem(
  actor: MarketItemActor,
  itemId: number,
  input: MarketItemAdminInput,
) {
  return prisma.$transaction((tx) => moderateMarketItemInTransaction(
    tx,
    actor,
    itemId,
    input,
  ));
}

export async function hideMarketItemForReportInTransaction(
  tx: any,
  actor: MarketItemActor,
  itemId: number,
  note = "",
  acquireLock = true,
) {
  if (!isMarketItemStaff(actor.role)) throw Errors.forbidden("需要管理员权限");
  if (acquireLock) await acquireMarketItemLock(tx, itemId);
  const current = await tx.marketItem.findUnique({ where: { id: itemId } });
  if (!current) throw Errors.notFound("商品不存在");
  const updated = await tx.marketItem.update({
    where: { id: itemId },
    data: {
      status: "hidden",
      moderationNote: note || current.moderationNote,
      moderatedAt: new Date(),
    },
  });
  await closePendingMarketItemInterest(tx, itemId);
  return updated;
}

export async function hideMarketItemForReport(
  actor: MarketItemActor,
  itemId: number,
  note = "",
) {
  return prisma.$transaction((tx) => hideMarketItemForReportInTransaction(
    tx,
    actor,
    itemId,
    note,
  ));
}
