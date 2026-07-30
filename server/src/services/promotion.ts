import crypto from "node:crypto";
import { prisma } from "../prisma";
import { amountCentsToMoney } from "./epay";
import { runWithDistributedLock } from "./cache";
import { runTrackedJob } from "./runtimeHealth";
import { isFeatureOn } from "./siteSettings";

export const PROMOTION_TYPES = ["listing_pin", "wanted_urgent", "home_featured", "merchant_homepage"] as const;
export const PROMOTION_TARGET_TYPES = ["market_item", "wanted_post", "merchant_profile"] as const;
export const PROMOTION_ORDER_STATUSES = ["waitlisted", "pending", "confirmed", "rejected", "cancelled", "expired"] as const;
export const PROMOTION_ADJUSTMENT_TYPES = ["service_extension", "refund_record", "compensation_record", "invoice_record", "complaint_record"] as const;
export type PromotionType = typeof PROMOTION_TYPES[number];
export type PromotionOrderStatus = typeof PROMOTION_ORDER_STATUSES[number];
export type PromotionAdjustmentType = typeof PROMOTION_ADJUSTMENT_TYPES[number];

const PROMOTION_EXPIRY_SWEEP_MS = 5 * 60 * 1000;
const PROMOTION_APPLICATION_LOCK_SCOPE = 1_205_003;
const PROMOTION_ORDER_LOCK_SCOPE = 1_205_004;
const PROMOTION_CAPACITY_LOCK_SCOPE = 1_205_005;
export const PROMOTION_PAYMENT_WINDOW_MS = 30 * 60 * 1000;
export const PROMOTION_PAYMENT_QR_URL = "/promotion-payment-placeholder.svg";
export const FIXED_HOME_PROMOTION_CAPACITY = 8;
const FIXED_CAPACITY_TYPES = new Set<PromotionType>(["home_featured", "wanted_urgent"]);
let promotionExpiryPollerStarted = false;

async function acquirePromotionLock(tx: any, scope: number, id: number) {
  const lockKey = BigInt(scope) * 4_294_967_296n + BigInt(id);
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${lockKey})`;
}

export const promotionOrderInclude = {
  plan: true,
  user: { select: { id: true, nickname: true, avatar: true, studentSso: true } },
  reviewedBy: { select: { id: true, nickname: true } },
  marketItem: { select: { id: true, title: true, status: true, sellerId: true } },
  wantedPost: { select: { id: true, title: true, status: true, authorId: true } },
  merchantProfile: { select: { id: true, slug: true, name: true, status: true, userId: true, inquiryCount: true } },
  adjustments: { include: { actor: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "asc" } },
} as const;

export function promotionTypeLabel(type: string) {
  return ({
    listing_pin: "商品置顶",
    wanted_urgent: "求购加急",
    home_featured: "首页推广",
    merchant_homepage: "合作商户主页",
  } as Record<string, string>)[type] || type;
}

export function promotionBadgeLabel(type: string) {
  return ({
    listing_pin: "置顶",
    wanted_urgent: "加急",
    home_featured: "推广",
    merchant_homepage: "合作商户",
  } as Record<string, string>)[type] || "推广";
}

export function serializePromotionPlan(plan: any) {
  return {
    ...plan,
    price: amountCentsToMoney(plan.priceCents),
    manualCost: amountCentsToMoney(plan.manualCostCents || 0),
    typeLabel: promotionTypeLabel(plan.type),
    badgeLabel: promotionBadgeLabel(plan.type),
  };
}

function maskVerificationReference(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-4)}`;
}

export function serializePromotionAdjustment(adjustment: any, privateView = false) {
  const { reference, ...safeAdjustment } = adjustment;
  return {
    ...safeAdjustment,
    reference: privateView ? reference : undefined,
    referenceMasked: maskVerificationReference(reference),
    amount: amountCentsToMoney(adjustment.amountCents || 0),
  };
}

export function serializePromotionOrder(order: any, privateView = false, paymentView = privateView) {
  const { verificationReference, paymentCode, adjustments, ...safeOrder } = order;
  const inquiryEnd = order.inquiryEndCount ?? order.merchantProfile?.inquiryCount ?? order.inquiryStartCount ?? 0;
  return {
    ...safeOrder,
    adjustments: Array.isArray(adjustments) ? adjustments.map((row) => serializePromotionAdjustment(row, privateView)) : [],
    verificationReference: privateView ? verificationReference : undefined,
    verificationReferenceMasked: maskVerificationReference(verificationReference),
    paymentCode: paymentView ? paymentCode : undefined,
    paymentQrUrl: paymentView && order.status === "pending" ? PROMOTION_PAYMENT_QR_URL : undefined,
    amount: amountCentsToMoney(order.amountCents),
    manualCost: amountCentsToMoney(order.manualCostCents || 0),
    verifiedAmount: order.verifiedAmountCents === null || order.verifiedAmountCents === undefined ? null : amountCentsToMoney(order.verifiedAmountCents),
    typeLabel: promotionTypeLabel(order.type),
    badgeLabel: promotionBadgeLabel(order.type),
    ctr: order.impressionCount > 0 ? Number(((order.clickCount / order.impressionCount) * 100).toFixed(2)) : 0,
    inquiriesAttributed: Math.max(0, inquiryEnd - (order.inquiryStartCount || 0)),
  };
}

function activeBadge(order: any, expiresAt: Date | string | null | undefined, type: PromotionType, now = new Date()) {
  if (!isFeatureOn("promotion") || !order || !expiresAt || new Date(expiresAt).getTime() <= now.getTime() || !isPromotionOrderActive(order, now)) return null;
  return {
    orderId: order.id,
    type,
    label: promotionBadgeLabel(type),
    expiresAt,
  };
}

export function serializeItemPromotions(item: any, now = new Date()) {
  const pinned = activeBadge(item.pinnedPromotionOrder, item.pinnedUntil, "listing_pin", now);
  const home = activeBadge(item.homePromotionOrder, item.homeFeaturedUntil, "home_featured", now);
  return { pinned, home, promoted: Boolean(pinned || home) };
}

export function serializeWantedPromotion(post: any, now = new Date()) {
  const urgent = activeBadge(post.urgentPromotionOrder, post.urgentUntil, "wanted_urgent", now);
  return { urgent, promoted: Boolean(urgent) };
}

export function serializeMerchantPromotion(profile: any, now = new Date()) {
  const homepage = activeBadge(profile.activePromotionOrder, profile.activeUntil, "merchant_homepage", now);
  return { homepage, promoted: Boolean(homepage) };
}

export function nextPromotionTradeNo(userId: number) {
  return `PR${Date.now()}U${userId}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export function nextPromotionPaymentCode() {
  return crypto.randomInt(0, 10_000).toString().padStart(4, "0");
}

function promotionPaymentExpiresAt(now = new Date()) {
  return new Date(now.getTime() + PROMOTION_PAYMENT_WINDOW_MS);
}

export function addPromotionDays(base: Date, durationDays: number) {
  return new Date(base.getTime() + Math.max(1, Math.trunc(durationDays)) * 24 * 60 * 60 * 1000);
}

export function nextPromotionWindow(currentUntil: Date | null | undefined, durationDays: number, now = new Date()) {
  const current = currentUntil ? new Date(currentUntil) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  return { startsAt: now, expiresAt: addPromotionDays(base, durationDays) };
}

export function ensurePromotionTransition(current: string, next: "confirmed" | "rejected" | "cancelled") {
  const allowed = next === "confirmed" ? ["pending"] : ["pending", "waitlisted"];
  if (!allowed.includes(current)) throw new Error("PROMOTION_ORDER_NOT_PENDING");
  return next;
}

async function promotionTargetState(tx: any, order: any, now: Date) {
  if (order.type === "listing_pin" || order.type === "home_featured") {
    const item = order.marketItem || await tx.marketItem.findUnique({ where: { id: order.marketItemId } });
    if (!item || item.sellerId !== order.userId || item.status !== "active" || item.visibility !== "public" || item.deliveryType !== "physical") {
      throw new Error("PROMOTION_TARGET_UNAVAILABLE");
    }
    const currentUntil = order.type === "listing_pin" ? item.pinnedUntil : item.homeFeaturedUntil;
    const currentPromotionOrderId = order.type === "listing_pin" ? item.pinnedPromotionOrderId : item.homePromotionOrderId;
    return { target: item, currentUntil, currentPromotionOrderId, renewing: Boolean(currentUntil && new Date(currentUntil).getTime() > now.getTime()) };
  }
  if (order.type === "wanted_urgent") {
    const wanted = order.wantedPost || await tx.wantedPost.findUnique({ where: { id: order.wantedPostId } });
    if (!wanted || wanted.authorId !== order.userId || !["active", "responded"].includes(wanted.status)) throw new Error("PROMOTION_TARGET_UNAVAILABLE");
    return { target: wanted, currentUntil: wanted.urgentUntil, currentPromotionOrderId: wanted.urgentPromotionOrderId, renewing: Boolean(wanted.urgentUntil && new Date(wanted.urgentUntil).getTime() > now.getTime()) };
  }
  if (order.type === "merchant_homepage") {
    const merchant = order.merchantProfile || await tx.merchantProfile.findUnique({ where: { id: order.merchantProfileId } });
    if (!merchant || merchant.userId !== order.userId || merchant.status !== "approved") throw new Error("PROMOTION_TARGET_UNAVAILABLE");
    return { target: merchant, currentUntil: merchant.activeUntil, currentPromotionOrderId: merchant.activePromotionOrderId, renewing: Boolean(merchant.activeUntil && new Date(merchant.activeUntil).getTime() > now.getTime()) };
  }
  throw new Error("PROMOTION_TYPE_UNSUPPORTED");
}

function capacityForPlan(plan: any) {
  if (FIXED_CAPACITY_TYPES.has(plan.type as PromotionType)) return FIXED_HOME_PROMOTION_CAPACITY;
  return Math.max(0, Number(plan.maxActive || 0));
}

async function reservedCapacity(tx: any, type: string, now: Date) {
  const [active, pending] = await Promise.all([
    tx.promotionOrder.count({ where: { type, status: "confirmed", startsAt: { lte: now }, expiresAt: { gt: now } } }),
    tx.promotionOrder.count({
      where: {
        type,
        status: "pending",
        reservesSlot: true,
        OR: [{ paymentSubmittedAt: { not: null } }, { paymentExpiresAt: null }, { paymentExpiresAt: { gt: now } }],
      },
    }),
  ]);
  return active + pending;
}

export async function createPendingPromotionOrder(db: any, userId: number, pendingWhere: any, data: any, now = new Date()) {
  return db.$transaction(async (tx: any) => {
    await acquirePromotionLock(tx, PROMOTION_APPLICATION_LOCK_SCOPE, userId);
    const duplicateWhere = { ...pendingWhere, status: { in: ["pending", "waitlisted"] } };
    if (await tx.promotionOrder.count({ where: duplicateWhere })) throw new Error("PROMOTION_PENDING_EXISTS");
    const plan = await tx.promotionPlan.findUnique({ where: { id: data.planId } });
    if (!plan || !plan.enabled) throw new Error("PROMOTION_PLAN_UNAVAILABLE");
    const target = await promotionTargetState(tx, data, now);
    const reservesSlot = !target.renewing;
    const capacity = capacityForPlan(plan);
    let status = "pending";
    if (reservesSlot && capacity > 0) {
      await acquirePromotionLock(tx, PROMOTION_CAPACITY_LOCK_SCOPE, Math.max(1, PROMOTION_TYPES.indexOf(data.type as PromotionType) + 1));
      if (await reservedCapacity(tx, data.type, now) >= capacity) status = "waitlisted";
    }
    return tx.promotionOrder.create({
      data: {
        ...data,
        status,
        reservesSlot,
        paymentCode: status === "pending" ? nextPromotionPaymentCode() : "",
        paymentExpiresAt: status === "pending" ? promotionPaymentExpiresAt(now) : null,
        waitlistedAt: status === "waitlisted" ? now : null,
      },
      include: promotionOrderInclude,
    });
  });
}

export function isPromotionOrderActive(order: { status: string; startsAt?: Date | string | null; expiresAt?: Date | string | null }, now = new Date()) {
  const startsAt = order.startsAt ? new Date(order.startsAt).getTime() : 0;
  const expiresAt = order.expiresAt ? new Date(order.expiresAt).getTime() : 0;
  return order.status === "confirmed" && startsAt <= now.getTime() && expiresAt > now.getTime();
}

export async function promoteWaitlistedOrders(db: any = prisma, now = new Date()) {
  const plans = await db.promotionPlan.findMany({
    where: { enabled: true, OR: [{ maxActive: { gt: 0 } }, { type: { in: ["home_featured", "wanted_urgent"] } }] },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  const planByType = new Map<string, any>();
  for (const plan of plans) if (!planByType.has(plan.type)) planByType.set(plan.type, plan);
  const result = { promoted: 0, rejected: 0 };

  for (const [type, plan] of planByType) {
    const capacity = capacityForPlan(plan);
    if (capacity < 1) continue;
    const counts = await db.$transaction(async (tx: any) => {
      await acquirePromotionLock(tx, PROMOTION_CAPACITY_LOCK_SCOPE, Math.max(1, PROMOTION_TYPES.indexOf(type as PromotionType) + 1));
      let available = capacity - await reservedCapacity(tx, type, now);
      let promoted = 0;
      let rejected = 0;
      while (available > 0) {
        const candidate = await tx.promotionOrder.findFirst({
          where: { type, status: "waitlisted" },
          orderBy: [{ waitlistedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          include: { plan: true, marketItem: true, wantedPost: true, merchantProfile: true },
        });
        if (!candidate) break;
        try {
          await promotionTargetState(tx, candidate, now);
        } catch (error: any) {
          if (!String(error?.message || "").startsWith("PROMOTION_")) throw error;
          const invalidated = await tx.promotionOrder.updateMany({
            where: { id: candidate.id, status: "waitlisted" },
            data: { status: "rejected", adminNote: "候补期间推广对象已失效，请恢复内容后重新申请。", rejectedAt: now },
          });
          if (invalidated.count) {
            rejected += 1;
            await tx.notification.create({
              data: {
                userId: candidate.userId,
                category: "market",
                level: "normal",
                title: "推广候补已结束",
                content: `${candidate.planName} 的推广对象已不可用，本次候补已结束；恢复内容后可以重新申请。`,
                link: "/market/promotions",
                source: "靠浦推广服务",
                payload: JSON.stringify({ promotionOrderId: candidate.id, status: "rejected" }),
              },
            });
          }
          continue;
        }
        const claimed = await tx.promotionOrder.updateMany({
          where: { id: candidate.id, status: "waitlisted" },
          data: {
            status: "pending",
            paymentCode: nextPromotionPaymentCode(),
            paymentExpiresAt: promotionPaymentExpiresAt(now),
            slotNotifiedAt: now,
          },
        });
        if (!claimed.count) continue;
        promoted += 1;
        available -= 1;
        await tx.notification.create({
          data: {
            userId: candidate.userId,
            category: "market",
            level: "strong",
            title: "推广位置已空出",
            content: `${candidate.planName} 现在可以启用。请在 30 分钟内进入推广订单扫码付款并确认四位秘钥；系统不会自动扣款或自动启用。`,
            link: "/market/promotions",
            source: "靠浦推广服务",
            payload: JSON.stringify({ promotionOrderId: candidate.id, status: "pending", paymentExpiresAt: promotionPaymentExpiresAt(now) }),
          },
        });
      }
      return { promoted, rejected };
    });
    result.promoted += counts.promoted;
    result.rejected += counts.rejected;
  }
  return result;
}

export async function refreshExpiredPromotions(db: any = prisma, now = new Date()) {
  const legacyPending = await db.promotionOrder.findMany({
    where: { status: "pending", paymentCode: "" },
    select: { id: true },
    take: 100,
  });
  const endingMerchantOrders = await db.promotionOrder.findMany({
    where: { status: "confirmed", expiresAt: { lte: now }, merchantProfileId: { not: null } },
    include: { merchantProfile: { select: { inquiryCount: true } } },
  });
  const [orders, paymentOrders, listingPins, homeFeatures, wantedUrgent, merchantPages] = await db.$transaction([
    db.promotionOrder.updateMany({
      where: { status: "confirmed", expiresAt: { lte: now } },
      data: { status: "expired" },
    }),
    db.promotionOrder.updateMany({
      where: { status: "pending", paymentSubmittedAt: null, paymentExpiresAt: { lte: now } },
      data: { status: "expired" },
    }),
    db.marketItem.updateMany({
      where: { pinnedUntil: { lte: now } },
      data: { pinnedUntil: null, pinnedPromotionOrderId: null },
    }),
    db.marketItem.updateMany({
      where: { homeFeaturedUntil: { lte: now } },
      data: { homeFeaturedUntil: null, homePromotionOrderId: null },
    }),
    db.wantedPost.updateMany({
      where: { urgentUntil: { lte: now } },
      data: { urgentUntil: null, urgentPromotionOrderId: null },
    }),
    db.merchantProfile.updateMany({
      where: { activeUntil: { lte: now } },
      data: { activeUntil: null, activePromotionOrderId: null },
    }),
    ...endingMerchantOrders.map((order: any) => db.promotionOrder.update({
      where: { id: order.id },
      data: { inquiryEndCount: order.merchantProfile?.inquiryCount ?? order.inquiryStartCount },
    })),
    ...legacyPending.map((order: any) => db.promotionOrder.update({
      where: { id: order.id },
      data: { paymentCode: nextPromotionPaymentCode(), paymentExpiresAt: promotionPaymentExpiresAt(now) },
    })),
  ]);
  const queue = await promoteWaitlistedOrders(db, now);
  return {
    orders: orders.count,
    paymentOrders: paymentOrders.count,
    listingPins: listingPins.count,
    homeFeatures: homeFeatures.count,
    wantedUrgent: wantedUrgent.count,
    merchantPages: merchantPages.count,
    queue,
  };
}

export async function confirmPromotionOrder(
  db: any,
  orderId: number,
  reviewerId: number,
  verification: string | {
    adminNote?: string;
    method?: string;
    reference?: string;
    paymentCode?: string;
    verifiedAmountCents?: number | null;
  } = "",
  now = new Date(),
) {
  return db.$transaction(async (tx: any) => {
    await acquirePromotionLock(tx, PROMOTION_ORDER_LOCK_SCOPE, orderId);
    const order = await tx.promotionOrder.findUnique({
      where: { id: orderId },
      include: { plan: true, marketItem: true, wantedPost: true, merchantProfile: true },
    });
    if (!order) throw new Error("PROMOTION_ORDER_NOT_FOUND");
    ensurePromotionTransition(order.status, "confirmed");
    const confirmation = typeof verification === "string" ? { adminNote: verification } : verification;
    if (!order.paymentSubmittedAt) throw new Error("PROMOTION_PAYMENT_NOT_SUBMITTED");
    if (!/^\d{4}$/.test(String(order.paymentCode || "")) || String(confirmation.paymentCode || "") !== order.paymentCode) {
      throw new Error("PROMOTION_PAYMENT_CODE_MISMATCH");
    }
    if (!String(confirmation.method || "").trim() || !String(confirmation.reference || "").trim()) {
      throw new Error("PROMOTION_VERIFICATION_REQUIRED");
    }
    const verifiedAmountCents = confirmation.verifiedAmountCents ?? order.amountCents;
    if (verifiedAmountCents !== order.amountCents) throw new Error("PROMOTION_VERIFIED_AMOUNT_MISMATCH");

    const targetState = await promotionTargetState(tx, order, now);
    const currentUntil = targetState.currentUntil;
    const currentPromotionOrderId = targetState.currentPromotionOrderId;

    await acquirePromotionLock(tx, PROMOTION_CAPACITY_LOCK_SCOPE, Math.max(1, PROMOTION_TYPES.indexOf(order.type as PromotionType) + 1));
    const renewingExistingSlot = targetState.renewing;
    const capacity = capacityForPlan(order.plan);
    if (!renewingExistingSlot && capacity > 0) {
      const activeCount = await tx.promotionOrder.count({
        where: { type: order.type, status: "confirmed", startsAt: { lte: now }, expiresAt: { gt: now } },
      });
      if (activeCount >= capacity) throw new Error("PROMOTION_CAPACITY_REACHED");
    }

    const { startsAt, expiresAt } = nextPromotionWindow(currentUntil, order.durationDays, now);
    if (renewingExistingSlot && currentPromotionOrderId && currentPromotionOrderId !== order.id) {
      await tx.promotionOrder.updateMany({
        where: { id: currentPromotionOrderId, status: "confirmed" },
        data: {
          status: "expired",
          expiresAt: now,
          inquiryEndCount: order.type === "merchant_homepage" ? (order.merchantProfile?.inquiryCount || 0) : undefined,
        },
      });
    }
    const updated = await tx.promotionOrder.update({
      where: { id: order.id },
      data: {
        status: "confirmed",
        adminNote: String(confirmation.adminNote || "").trim().slice(0, 500),
        verificationMethod: String(confirmation.method || "manual_admin").trim().slice(0, 40),
        verificationReference: String(confirmation.reference || "兼容客户端人工确认").trim().slice(0, 120),
        verifiedAmountCents,
        manualCostCents: order.manualCostCents,
        inquiryStartCount: order.type === "merchant_homepage" ? (order.merchantProfile?.inquiryCount || 0) : 0,
        reviewedById: reviewerId,
        reviewedAt: now,
        confirmedAt: now,
        startsAt,
        expiresAt,
      },
    });

    if (order.type === "listing_pin") {
      await tx.marketItem.update({ where: { id: order.marketItemId }, data: { pinnedUntil: expiresAt, pinnedPromotionOrderId: order.id } });
    } else if (order.type === "home_featured") {
      await tx.marketItem.update({ where: { id: order.marketItemId }, data: { homeFeaturedUntil: expiresAt, homePromotionOrderId: order.id } });
    } else if (order.type === "wanted_urgent") {
      await tx.wantedPost.update({ where: { id: order.wantedPostId }, data: { urgentUntil: expiresAt, urgentPromotionOrderId: order.id } });
    } else {
      await tx.merchantProfile.update({ where: { id: order.merchantProfileId }, data: { activeUntil: expiresAt, activePromotionOrderId: order.id } });
    }
    return updated;
  });
}

export async function submitPromotionPaymentClaim(db: any, orderId: number, userId: number, paymentCode: string, now = new Date()) {
  return db.$transaction(async (tx: any) => {
    await acquirePromotionLock(tx, PROMOTION_ORDER_LOCK_SCOPE, orderId);
    const order = await tx.promotionOrder.findUnique({ where: { id: orderId }, include: promotionOrderInclude });
    if (!order || order.userId !== userId) throw new Error("PROMOTION_ORDER_NOT_FOUND");
    if (order.status !== "pending") throw new Error("PROMOTION_ORDER_NOT_PENDING");
    if (order.paymentSubmittedAt) return order;
    if (order.paymentExpiresAt && new Date(order.paymentExpiresAt).getTime() <= now.getTime()) throw new Error("PROMOTION_PAYMENT_EXPIRED");
    if (!/^\d{4}$/.test(paymentCode) || paymentCode !== order.paymentCode) throw new Error("PROMOTION_PAYMENT_CODE_MISMATCH");
    return tx.promotionOrder.update({
      where: { id: order.id },
      data: { paymentSubmittedAt: now, paymentExpiresAt: null },
      include: promotionOrderInclude,
    });
  });
}

export async function rejectPromotionOrder(db: any, orderId: number, reviewerId: number, adminNote: string, now = new Date()) {
  const updated = await db.$transaction(async (tx: any) => {
    await acquirePromotionLock(tx, PROMOTION_ORDER_LOCK_SCOPE, orderId);
    const order = await tx.promotionOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("PROMOTION_ORDER_NOT_FOUND");
    ensurePromotionTransition(order.status, "rejected");
    return tx.promotionOrder.update({
      where: { id: orderId },
      data: {
        status: "rejected",
        adminNote: adminNote.trim().slice(0, 500),
        reviewedById: reviewerId,
        reviewedAt: now,
        rejectedAt: now,
      },
    });
  });
  await promoteWaitlistedOrders(db, now);
  return updated;
}

export async function cancelPromotionOrder(db: any, orderId: number, userId: number, now = new Date()) {
  const updated = await db.$transaction(async (tx: any) => {
    await acquirePromotionLock(tx, PROMOTION_ORDER_LOCK_SCOPE, orderId);
    const order = await tx.promotionOrder.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new Error("PROMOTION_ORDER_NOT_FOUND");
    ensurePromotionTransition(order.status, "cancelled");
    return tx.promotionOrder.update({ where: { id: orderId }, data: { status: "cancelled", cancelledAt: now } });
  });
  await promoteWaitlistedOrders(db, now);
  return updated;
}

export async function createPromotionAdjustment(db: any, input: {
  orderId: number;
  actorId: number;
  type: PromotionAdjustmentType;
  amountCents?: number;
  extensionDays?: number;
  reference?: string;
  note: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx: any) => {
    await acquirePromotionLock(tx, PROMOTION_ORDER_LOCK_SCOPE, input.orderId);
    const order = await tx.promotionOrder.findUnique({
      where: { id: input.orderId },
      include: { marketItem: true, wantedPost: true, merchantProfile: true },
    });
    if (!order) throw new Error("PROMOTION_ORDER_NOT_FOUND");
    if (!["confirmed", "expired"].includes(order.status)) throw new Error("PROMOTION_ADJUSTMENT_NOT_ALLOWED");

    const amountCents = Math.max(0, Math.trunc(input.amountCents || 0));
    if (amountCents > order.amountCents) throw new Error("PROMOTION_ADJUSTMENT_AMOUNT_TOO_LARGE");
    const extensionDays = Math.max(0, Math.trunc(input.extensionDays || 0));
    if (input.type === "service_extension") {
      if (order.status !== "confirmed" || !order.expiresAt || extensionDays < 1 || extensionDays > 365) {
        throw new Error("PROMOTION_EXTENSION_NOT_ALLOWED");
      }
      const expiresAt = addPromotionDays(new Date(order.expiresAt), extensionDays);
      let updatedTarget = { count: 0 };
      if (order.type === "listing_pin") {
        updatedTarget = await tx.marketItem.updateMany({ where: { id: order.marketItemId, pinnedPromotionOrderId: order.id }, data: { pinnedUntil: expiresAt } });
      } else if (order.type === "home_featured") {
        updatedTarget = await tx.marketItem.updateMany({ where: { id: order.marketItemId, homePromotionOrderId: order.id }, data: { homeFeaturedUntil: expiresAt } });
      } else if (order.type === "wanted_urgent") {
        updatedTarget = await tx.wantedPost.updateMany({ where: { id: order.wantedPostId, urgentPromotionOrderId: order.id }, data: { urgentUntil: expiresAt } });
      } else if (order.type === "merchant_homepage") {
        updatedTarget = await tx.merchantProfile.updateMany({ where: { id: order.merchantProfileId, activePromotionOrderId: order.id }, data: { activeUntil: expiresAt } });
      }
      if (!updatedTarget.count) throw new Error("PROMOTION_EXTENSION_NOT_ALLOWED");
      await tx.promotionOrder.update({ where: { id: order.id }, data: { expiresAt, renewalReminderSentAt: null } });
    }

    return tx.promotionAdjustment.create({
      data: {
        orderId: order.id,
        actorId: input.actorId,
        type: input.type,
        amountCents,
        extensionDays: input.type === "service_extension" ? extensionDays : 0,
        reference: String(input.reference || "").trim().slice(0, 120),
        note: String(input.note || "").trim().slice(0, 500),
      },
      include: { actor: { select: { id: true, nickname: true } } },
    });
  });
}

export async function sendPromotionRenewalReminders(db: any = prisma, now = new Date()) {
  const reminderUntil = addPromotionDays(now, 3);
  const orders = await db.promotionOrder.findMany({
    where: { status: "confirmed", renewalReminderSentAt: null, expiresAt: { gt: now, lte: reminderUntil } },
    select: { id: true, userId: true, planName: true, expiresAt: true },
    take: 100,
  });
  let sent = 0;
  for (const order of orders) {
    const created = await db.$transaction(async (tx: any) => {
      const claimed = await tx.promotionOrder.updateMany({ where: { id: order.id, renewalReminderSentAt: null }, data: { renewalReminderSentAt: now } });
      if (!claimed.count) return false;
      await tx.notification.create({ data: { userId: order.userId, category: "market", level: "normal", title: "推广服务即将到期", content: `${order.planName} 将于 3 天内到期；如需续期，请重新提交申请，管理员仍会逐单人工核验。`, link: "/market/promotions", source: "靠浦推广服务", payload: JSON.stringify({ promotionOrderId: order.id, expiresAt: order.expiresAt }) } });
      return true;
    });
    if (created) sent += 1;
  }
  return sent;
}

export async function sendMerchantReviewReminders(db: any = prisma, now = new Date()) {
  const reminderUntil = addPromotionDays(now, 7);
  const profiles = await db.merchantProfile.findMany({
    where: { status: "approved", reviewReminderSentAt: null, reviewDueAt: { gt: now, lte: reminderUntil } },
    select: { id: true, userId: true, name: true, reviewDueAt: true },
    take: 100,
  });
  let sent = 0;
  for (const profile of profiles) {
    const created = await db.$transaction(async (tx: any) => {
      const claimed = await tx.merchantProfile.updateMany({ where: { id: profile.id, reviewReminderSentAt: null }, data: { reviewReminderSentAt: now } });
      if (!claimed.count) return false;
      await tx.notification.create({ data: { userId: profile.userId, category: "market", level: "normal", title: "合作商户资料即将复核", content: `${profile.name} 将在 7 天内进入周期复核，请提前检查服务信息和联系方式是否仍然有效。`, link: "/market/merchant/apply", source: "靠浦推广服务", payload: JSON.stringify({ merchantProfileId: profile.id, reviewDueAt: profile.reviewDueAt }) } });
      return true;
    });
    if (created) sent += 1;
  }
  return sent;
}

export async function recordPromotionEvent(db: any, input: {
  orderId: number;
  type: "impression" | "click";
  audienceKey: string;
  now?: Date;
}) {
  if (!isFeatureOn("promotion")) return null;
  const now = input.now ?? new Date();
  const order = await db.promotionOrder.findUnique({ where: { id: input.orderId } });
  if (!order || !isPromotionOrderActive(order, now)) return null;
  const day = now.toISOString().slice(0, 10);
  const dedupeKey = crypto.createHash("sha256")
    .update(`${order.id}:${input.type}:${day}:${input.audienceKey}`)
    .digest("hex");
  return db.$transaction(async (tx: any) => {
    const inserted = await tx.promotionEvent.createMany({
      data: [{ orderId: order.id, type: input.type, dedupeKey }],
      skipDuplicates: true,
    });
    if (!inserted.count) {
      return tx.promotionOrder.findUnique({ where: { id: order.id }, select: { id: true, impressionCount: true, clickCount: true } });
    }
    return tx.promotionOrder.update({
      where: { id: order.id },
      data: input.type === "impression" ? { impressionCount: { increment: 1 } } : { clickCount: { increment: 1 } },
      select: { id: true, impressionCount: true, clickCount: true },
    });
  });
}

export function startPromotionExpiryPoller() {
  if (promotionExpiryPollerStarted) return;
  promotionExpiryPollerStarted = true;
  const tick = () => {
    runTrackedJob(
      "promotion-expiry",
      "推广到期与续期提醒",
      () => runWithDistributedLock("promotion-expiry-sweep", 4 * 60_000, async () => ({
        expired: await refreshExpiredPromotions(),
        renewalReminders: await sendPromotionRenewalReminders(),
      })),
      PROMOTION_EXPIRY_SWEEP_MS,
    )
      .catch((error) => console.warn("[promotion] expiry sweep failed", error));
  };
  tick();
  const timer = setInterval(tick, PROMOTION_EXPIRY_SWEEP_MS);
  timer.unref?.();
}
