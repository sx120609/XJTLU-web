import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { config } from "../config";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { queryPage, querySize } from "../utils/query";
import { MARKET_PUBLIC_USER_SELECT } from "../services/marketPublicUser";
import { evaluateMarketContent, logMarketAdminAction, maskMarketContact, openMarketContact, sealMarketContact } from "../services/marketTrust";
import { toggleMerchantFavorite } from "../services/marketCounters";
import {
  PROMOTION_TYPES,
  PROMOTION_ADJUSTMENT_TYPES,
  cancelPromotionOrder,
  confirmPromotionOrder,
  createPendingPromotionOrder,
  createPromotionAdjustment,
  isPromotionOrderActive,
  nextPromotionTradeNo,
  promotionOrderInclude,
  recordPromotionEvent,
  refreshExpiredPromotions,
  rejectPromotionOrder,
  serializeMerchantPromotion,
  serializePromotionOrder,
  serializePromotionPlan,
  submitPromotionPaymentClaim,
} from "../services/promotion";
import { getMarketOperationsDashboard } from "../services/marketOperations";
import { isFeatureOn } from "../services/siteSettings";

export const marketPromotionsRouter = Router();

const CONTACT_METHODS = ["wechat", "qq", "phone", "email", "website", "other"] as const;
const imageUrlSchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  "图片地址格式不正确",
);
const merchantInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,39}$/, "主页地址需为 3—40 位小写字母、数字或连字符"),
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().min(2).max(40),
  description: z.string().trim().min(20).max(5000),
  priceRange: z.string().trim().min(1).max(200),
  serviceArea: z.string().trim().min(1).max(200),
  studentDiscount: z.string().trim().max(300).optional().default(""),
  contactMethod: z.enum(CONTACT_METHODS),
  contactValue: z.string().trim().min(2).max(300),
  images: z.array(imageUrlSchema).max(9).optional().default([]),
});
const promotionOrderSchema = z.object({
  planCode: z.string().trim().min(2).max(80),
  targetId: z.number().int().positive(),
  note: z.string().trim().max(500).optional().default(""),
});
const promotionEventSchema = z.object({ type: z.enum(["impression", "click"]) });
const promotionPaymentClaimSchema = z.object({ paymentCode: z.string().trim().regex(/^\d{4}$/, "请输入订单显示的四位付款秘钥") });
const promotionPlanPatchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  manualCost: z.union([z.string(), z.number()]).optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
  maxActive: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
  sort: z.number().int().min(0).max(10000).optional(),
});
const promotionAdjustmentSchema = z.object({
  type: z.enum(PROMOTION_ADJUSTMENT_TYPES),
  amount: z.union([z.string(), z.number()]).optional(),
  extensionDays: z.number().int().min(0).max(365).optional().default(0),
  reference: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().min(2).max(500),
}).superRefine((value, context) => {
  if (value.type === "service_extension" && value.extensionDays < 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["extensionDays"], message: "延长天数至少为 1 天" });
  }
  if (["refund_record", "invoice_record"].includes(value.type) && value.reference.length < 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reference"], message: "退款或票据记录必须填写外部凭证号" });
  }
});
const promotionOrderActionSchema = z.object({
  action: z.enum(["confirm", "reject"]),
  note: z.string().trim().max(500).optional().default(""),
  verificationMethod: z.enum(["alipay", "wechat", "bank", "cash", "other"]).optional(),
  verificationReference: z.string().trim().max(120).optional(),
  verifiedAmount: z.union([z.string(), z.number()]).optional(),
  paymentCode: z.string().trim().regex(/^\d{4}$/).optional(),
}).superRefine((value, context) => {
  if (value.action === "confirm") {
    if (!value.verificationMethod) context.addIssue({ code: z.ZodIssueCode.custom, path: ["verificationMethod"], message: "请选择实际收款方式" });
    if (!value.verificationReference || value.verificationReference.length < 2) context.addIssue({ code: z.ZodIssueCode.custom, path: ["verificationReference"], message: "请填写收款流水号" });
    if (value.verifiedAmount === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["verifiedAmount"], message: "请填写实际收款金额" });
    if (!value.paymentCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentCode"], message: "请核对并填写四位付款秘钥" });
    if (value.note.length < 2) context.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "请填写至少 2 个字的核验备注" });
  } else if (value.note.length < 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "驳回时必须填写原因" });
  }
});
const merchantReviewSchema = z.object({
  status: z.enum(["approved", "rejected", "suspended"]),
  note: z.string().trim().max(500).optional().default(""),
});

function parseImages(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 9) : [];
  } catch {
    return [];
  }
}

function promotionPriceCents(value: string | number) {
  if (typeof value === "string" && !value.trim()) throw Errors.badRequest("推广价格不能为空");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999) throw Errors.badRequest("推广价格格式不正确");
  return Math.round(amount * 100);
}

function isStaff(role?: string | null) {
  return role === "admin" || role === "mod";
}

function promotionScope(value: unknown) {
  const scope = String(value || "").trim();
  if (scope && !["content", "merchant"].includes(scope)) throw Errors.badRequest("推广服务范围不正确");
  return scope as "" | "content" | "merchant";
}

function ensureAdmin(req: any) {
  if (req.user?.role !== "admin") throw Errors.forbidden("仅管理员可管理推广服务");
}

async function ensureVerifiedUser(req: any) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, role: true, status: true, studentSso: true },
  });
  if (!user) throw Errors.unauthorized();
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  if (!isStaff(user.role) && !user.studentSso) throw Errors.forbidden("仅限通过 XJTLU 统一认证的用户使用推广与商户服务");
  return user;
}

function merchantInclude(viewerId?: number) {
  return {
    user: { select: MARKET_PUBLIC_USER_SELECT },
    activePromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
    favorites: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
  } as const;
}

function serializeMerchant(profile: any, viewerId?: number, privateView = false) {
  const { contactValueEncrypted, reviewNote, reviewedById, reviewDueAt, reviewReminderSentAt, favorites, activePromotionOrder, ...safe } = profile;
  return {
    ...safe,
    images: parseImages(profile.images),
    contactValueMasked: profile.contactValueMasked,
    reviewNote: privateView ? reviewNote : undefined,
    reviewedById: privateView ? reviewedById : undefined,
    reviewDueAt: privateView ? reviewDueAt : undefined,
    reviewReminderSentAt: privateView ? reviewReminderSentAt : undefined,
    favorited: Array.isArray(profile.favorites) && profile.favorites.length > 0,
    mine: Boolean(viewerId && profile.userId === viewerId),
    promotion: serializeMerchantPromotion(profile),
  };
}

function audienceKey(req: any) {
  // Express has already resolved req.ip according to the configured trusted-proxy hops.
  // Reading X-Forwarded-For directly would let a public client bypass daily deduplication.
  const userPart = req.user?.userId ? `user:${req.user.userId}` : `guest:${String(req.ip || req.socket?.remoteAddress || "").trim()}`;
  const agent = String(req.headers["user-agent"] || "").slice(0, 300);
  return crypto.createHash("sha256").update(`${config.jwtSecret}:${userPart}:${agent}`).digest("hex");
}

function handlePromotionServiceError(error: any) {
  if (error?.message === "PROMOTION_ORDER_NOT_FOUND") return Errors.notFound("推广订单不存在");
  if (error?.message === "PROMOTION_ORDER_NOT_PENDING") return Errors.badRequest("该推广订单已处理，不能重复操作");
  if (error?.message === "PROMOTION_PENDING_EXISTS") return Errors.conflict("相同推广方案已有待付款或候补订单");
  if (error?.message === "PROMOTION_PLAN_UNAVAILABLE") return Errors.badRequest("推广方案当前不可用");
  if (error?.message === "PROMOTION_TARGET_UNAVAILABLE") return Errors.badRequest("推广对象当前不可用，请先恢复为公开有效状态");
  if (error?.message === "PROMOTION_TYPE_UNSUPPORTED") return Errors.badRequest("暂不支持该推广类型");
  if (error?.message === "PROMOTION_VERIFIED_AMOUNT_MISMATCH") return Errors.badRequest("人工核验金额与订单快照金额不一致");
  if (error?.message === "PROMOTION_PAYMENT_NOT_SUBMITTED") return Errors.badRequest("用户尚未在订单页确认付款秘钥，不能启用推广");
  if (error?.message === "PROMOTION_PAYMENT_CODE_MISMATCH") return Errors.badRequest("四位付款秘钥不一致，请对照订单与收款备注重新核验");
  if (error?.message === "PROMOTION_PAYMENT_EXPIRED") return Errors.badRequest("付款位置保留时间已结束，请重新申请或等待候补通知");
  if (error?.message === "PROMOTION_VERIFICATION_REQUIRED") return Errors.badRequest("启用推广前必须完整核验收款方式、流水号、实收金额和四位秘钥");
  if (error?.message === "PROMOTION_CAPACITY_REACHED") return Errors.conflict("目前推广服务已满，请等待系统释放位置并通知候补用户");
  if (error?.message === "PROMOTION_ADJUSTMENT_NOT_ALLOWED") return Errors.badRequest("当前订单状态不允许登记售后调整");
  if (error?.message === "PROMOTION_ADJUSTMENT_AMOUNT_TOO_LARGE") return Errors.badRequest("调整金额不能超过订单核验金额");
  if (error?.message === "PROMOTION_EXTENSION_NOT_ALLOWED") return Errors.badRequest("只能延长当前仍在生效且未被续期替换的推广");
  return error;
}

async function notifyPromotion(userId: number, title: string, content: string, link: string, payload: Record<string, unknown>) {
  await prisma.notification.create({
    data: { userId, category: "market", level: "normal", title, content, link, source: "靠浦推广服务", payload: JSON.stringify(payload) },
  }).catch(() => null);
}

marketPromotionsRouter.get("/promotions/plans", async (req, res, next) => {
  try {
    if (!isFeatureOn("promotion")) return ok(res, []);
    const scope = promotionScope(req.query.scope);
    const where: any = { enabled: true };
    if (scope) where.targetType = scope === "merchant" ? "merchant_profile" : { not: "merchant_profile" };
    const list = await prisma.promotionPlan.findMany({ where, orderBy: [{ sort: "asc" }, { id: "asc" }] });
    ok(res, list.map(serializePromotionPlan));
  } catch (error) { next(error); }
});

marketPromotionsRouter.get("/promotions/orders", authRequired, async (req, res, next) => {
  try {
    await refreshExpiredPromotions();
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 20, 5, 50);
    const status = String(req.query.status || "").trim();
    const scope = promotionScope(req.query.scope);
    const where: any = { userId: req.user!.userId };
    if (status) where.status = status;
    if (scope) where.targetType = scope === "merchant" ? "merchant_profile" : { not: "merchant_profile" };
    const [list, total] = await Promise.all([
      prisma.promotionOrder.findMany({ where, include: promotionOrderInclude, orderBy: { createdAt: "desc" }, skip: (page - 1) * size, take: size }),
      prisma.promotionOrder.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((order) => serializePromotionOrder(order, false, true)) });
  } catch (error) { next(error); }
});

marketPromotionsRouter.post("/promotions/orders", authRequired, validate(promotionOrderSchema), async (req, res, next) => {
  try {
    if (!isFeatureOn("promotion")) throw Errors.badRequest("推广服务当前已暂停，学生交易、求购和免费学习内容不受影响");
    const user = await ensureVerifiedUser(req);
    await refreshExpiredPromotions();
    const plan = await prisma.promotionPlan.findUnique({ where: { code: req.body.planCode } });
    if (!plan || !plan.enabled || !PROMOTION_TYPES.includes(plan.type as any)) throw Errors.badRequest("推广方案不可用");

    const data: any = {
      userId: user.id,
      planId: plan.id,
      outTradeNo: nextPromotionTradeNo(user.id),
      planCode: plan.code,
      planName: plan.name,
      type: plan.type,
      targetType: plan.targetType,
      placement: plan.placement,
      amountCents: plan.priceCents,
      manualCostCents: plan.manualCostCents,
      durationDays: plan.durationDays,
      paymentMode: "manual",
      status: "pending",
      applicantNote: req.body.note,
    };
    const pendingWhere: any = { userId: user.id, type: plan.type, status: "pending" };
    if (plan.targetType === "market_item") {
      const item = await prisma.marketItem.findUnique({ where: { id: req.body.targetId } });
      if (!item || item.sellerId !== user.id || item.status !== "active" || item.visibility !== "public" || item.deliveryType !== "physical") throw Errors.badRequest("只能推广自己公开在售的实体商品");
      data.marketItemId = item.id;
      pendingWhere.marketItemId = item.id;
    } else if (plan.targetType === "wanted_post") {
      const wanted = await prisma.wantedPost.findUnique({ where: { id: req.body.targetId } });
      if (!wanted || wanted.authorId !== user.id || !["active", "responded"].includes(wanted.status)) throw Errors.badRequest("只能加急自己当前有效的求购");
      data.wantedPostId = wanted.id;
      pendingWhere.wantedPostId = wanted.id;
    } else if (plan.targetType === "merchant_profile") {
      const merchant = await prisma.merchantProfile.findUnique({ where: { id: req.body.targetId } });
      if (!merchant || merchant.userId !== user.id || merchant.status !== "approved") throw Errors.badRequest("商户资料通过审核后才能申请主页推广");
      data.merchantProfileId = merchant.id;
      pendingWhere.merchantProfileId = merchant.id;
    } else {
      throw Errors.badRequest("推广对象类型不受支持");
    }
    const order = await createPendingPromotionOrder(prisma, user.id, pendingWhere, data);
    ok(res, serializePromotionOrder(order, false, true));
  } catch (error) { next(handlePromotionServiceError(error)); }
});

marketPromotionsRouter.post("/promotions/orders/:id/payment-claim", authRequired, validate(promotionPaymentClaimSchema), async (req, res, next) => {
  try {
    const row = await submitPromotionPaymentClaim(prisma, Number(req.params.id), req.user!.userId, req.body.paymentCode);
    ok(res, serializePromotionOrder(row, false, true));
  } catch (error) { next(handlePromotionServiceError(error)); }
});

marketPromotionsRouter.post("/promotions/orders/:id/cancel", authRequired, async (req, res, next) => {
  try {
    const row = await cancelPromotionOrder(prisma, Number(req.params.id), req.user!.userId);
    ok(res, serializePromotionOrder(row, false, true));
  } catch (error) { next(handlePromotionServiceError(error)); }
});

marketPromotionsRouter.post("/promotions/orders/:id/events", validate(promotionEventSchema), async (req, res, next) => {
  try {
    const result = await recordPromotionEvent(prisma, {
      orderId: Number(req.params.id),
      type: req.body.type,
      audienceKey: audienceKey(req),
    });
    ok(res, result || { ignored: true });
  } catch (error) { next(error); }
});

marketPromotionsRouter.get("/merchant/me", authRequired, async (req, res, next) => {
  try {
    await refreshExpiredPromotions();
    const profile = await prisma.merchantProfile.findUnique({ where: { userId: req.user!.userId }, include: merchantInclude(req.user!.userId) });
    ok(res, profile ? serializeMerchant(profile, req.user!.userId, true) : null);
  } catch (error) { next(error); }
});

marketPromotionsRouter.put("/merchant/me", authRequired, validate(merchantInputSchema), async (req, res, next) => {
  try {
    const user = await ensureVerifiedUser(req);
    const risk = await evaluateMarketContent(prisma, [req.body.name, req.body.description, req.body.priceRange, req.body.serviceArea, req.body.studentDiscount], "market");
    if (risk.action === "block") throw Errors.badRequest(`商户资料包含不允许发布的内容：${risk.matches[0]?.keyword || "高风险信息"}`);
    const slugOwner = await prisma.merchantProfile.findUnique({ where: { slug: req.body.slug }, select: { userId: true } });
    if (slugOwner && slugOwner.userId !== user.id) throw Errors.conflict("该商户主页地址已被使用");
    const encrypted = sealMarketContact(req.body.contactValue);
    const masked = maskMarketContact(req.body.contactMethod, req.body.contactValue);
    const data = {
      slug: req.body.slug,
      name: req.body.name,
      category: req.body.category,
      description: req.body.description,
      priceRange: req.body.priceRange,
      serviceArea: req.body.serviceArea,
      studentDiscount: req.body.studentDiscount,
      contactMethod: req.body.contactMethod,
      contactValueEncrypted: encrypted,
      contactValueMasked: masked,
      images: JSON.stringify(req.body.images),
      status: "reviewing",
      reviewNote: risk.action === "review" ? `内容规则命中：${risk.matches[0]?.keyword || "需人工复核"}` : "",
      reviewedById: null,
      reviewedAt: null,
      reviewDueAt: null,
      reviewReminderSentAt: null,
    };
    const profile = await prisma.merchantProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
      include: merchantInclude(user.id),
    });
    ok(res, serializeMerchant(profile, user.id, true));
  } catch (error) { next(error); }
});

marketPromotionsRouter.get("/merchants", async (req, res, next) => {
  try {
    if (!isFeatureOn("promotion")) return ok(res, { page: queryPage(req.query.page), size: querySize(req.query.size, 20, 8, 40), total: 0, list: [] });
    await refreshExpiredPromotions();
    const now = new Date();
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 20, 8, 40);
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const where: any = {
      status: "approved",
      activeUntil: { gt: now },
      activePromotionOrderId: { not: null },
      activePromotionOrder: { is: { status: "confirmed", startsAt: { lte: now }, expiresAt: { gt: now } } },
    };
    if (category) where.category = category;
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { serviceArea: { contains: q, mode: "insensitive" } }];
    const [list, total] = await Promise.all([
      prisma.merchantProfile.findMany({ where, include: merchantInclude(req.user?.userId), orderBy: [{ activeUntil: "desc" }, { createdAt: "desc" }], skip: (page - 1) * size, take: size }),
      prisma.merchantProfile.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((row) => serializeMerchant(row, req.user?.userId)) });
  } catch (error) { next(error); }
});

marketPromotionsRouter.get("/merchants/:slug", async (req, res, next) => {
  try {
    await refreshExpiredPromotions();
    const profile = await prisma.merchantProfile.findUnique({ where: { slug: String(req.params.slug).toLowerCase() }, include: merchantInclude(req.user?.userId) });
    if (!profile) throw Errors.notFound("商户主页不存在");
    const privateView = profile.userId === req.user?.userId || isStaff(req.user?.role);
    const publicActive = isFeatureOn("promotion") && profile.status === "approved" && profile.activeUntil && profile.activeUntil > new Date() && profile.activePromotionOrder && isPromotionOrderActive(profile.activePromotionOrder);
    if (!privateView && !publicActive) throw Errors.notFound("商户主页尚未启用");
    if (publicActive && !privateView) prisma.merchantProfile.update({ where: { id: profile.id }, data: { viewCount: { increment: 1 } } }).catch(() => null);
    ok(res, serializeMerchant(profile, req.user?.userId, privateView));
  } catch (error) { next(error); }
});

marketPromotionsRouter.post("/merchants/:slug/favorite", authRequired, async (req, res, next) => {
  try {
    if (!isFeatureOn("promotion")) throw Errors.notFound("商户展示当前已暂停");
    await ensureVerifiedUser(req);
    const profile = await prisma.merchantProfile.findUnique({ where: { slug: String(req.params.slug).toLowerCase() }, include: { activePromotionOrder: true } });
    if (!profile || profile.status !== "approved" || !profile.activeUntil || profile.activeUntil <= new Date() || !profile.activePromotionOrder || !isPromotionOrderActive(profile.activePromotionOrder)) throw Errors.notFound("商户主页不存在");
    if (profile.userId === req.user!.userId) throw Errors.badRequest("不能收藏自己的商户主页");
    ok(res, await toggleMerchantFavorite(profile.id, req.user!.userId));
  } catch (error) { next(error); }
});

marketPromotionsRouter.post("/merchants/:slug/inquiry", authRequired, async (req, res, next) => {
  try {
    if (!isFeatureOn("promotion")) throw Errors.notFound("商户展示当前已暂停");
    await ensureVerifiedUser(req);
    const profile = await prisma.merchantProfile.findUnique({ where: { slug: String(req.params.slug).toLowerCase() }, include: { activePromotionOrder: true } });
    if (!profile || profile.status !== "approved" || !profile.activeUntil || profile.activeUntil <= new Date() || !profile.activePromotionOrder || !isPromotionOrderActive(profile.activePromotionOrder)) throw Errors.notFound("商户主页不存在");
    if (profile.userId === req.user!.userId) throw Errors.badRequest("不能咨询自己的商户主页");
    const dayKey = new Date().toISOString().slice(0, 10);
    const { counted, inquiryCount } = await prisma.$transaction(async (tx) => {
      const inserted = await tx.merchantInquiry.createMany({
        data: [{ merchantProfileId: profile.id, userId: req.user!.userId, dayKey }],
        skipDuplicates: true,
      });
      const current = inserted.count
        ? await tx.merchantProfile.update({ where: { id: profile.id }, data: { inquiryCount: { increment: 1 } }, select: { inquiryCount: true } })
        : await tx.merchantProfile.findUnique({ where: { id: profile.id }, select: { inquiryCount: true } });
      return { counted: inserted.count > 0, inquiryCount: current?.inquiryCount ?? profile.inquiryCount };
    });
    ok(res, { method: profile.contactMethod, value: openMarketContact(profile.contactValueEncrypted), counted, inquiryCount });
  } catch (error) { next(error); }
});

marketPromotionsRouter.get("/admin/promotions/overview", authRequired, async (req, res, next) => {
  try {
    ensureAdmin(req);
    await refreshExpiredPromotions();
    const [plans, pendingOrders, waitlistedOrders, confirmedOrders, merchantReviewing, revenue, manualCosts, adjustmentTotals, impressions, clicks] = await Promise.all([
      prisma.promotionPlan.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
      prisma.promotionOrder.count({ where: { status: "pending" } }),
      prisma.promotionOrder.count({ where: { status: "waitlisted" } }),
      prisma.promotionOrder.count({ where: { status: "confirmed" } }),
      prisma.merchantProfile.count({ where: { status: "reviewing" } }),
      prisma.promotionOrder.aggregate({ where: { status: { in: ["confirmed", "expired"] } }, _sum: { amountCents: true } }),
      prisma.promotionOrder.aggregate({ where: { status: { in: ["confirmed", "expired"] } }, _sum: { manualCostCents: true } }),
      prisma.promotionAdjustment.groupBy({ by: ["type"], _sum: { amountCents: true }, _count: true }),
      prisma.promotionOrder.aggregate({ _sum: { impressionCount: true } }),
      prisma.promotionOrder.aggregate({ _sum: { clickCount: true } }),
    ]);
    const adjustmentByType = new Map(adjustmentTotals.map((row) => [row.type, row]));
    const refundCents = adjustmentByType.get("refund_record")?._sum.amountCents || 0;
    const compensationCents = adjustmentByType.get("compensation_record")?._sum.amountCents || 0;
    const manualCostCents = manualCosts._sum.manualCostCents || 0;
    const revenueCents = revenue._sum.amountCents || 0;
    ok(res, {
      plans: plans.map(serializePromotionPlan),
      counts: { pendingOrders, waitlistedOrders, confirmedOrders, merchantReviewing },
      revenueCents,
      revenue: (revenueCents / 100).toFixed(2),
      refundCents,
      compensationCents,
      manualCostCents,
      netContributionCents: revenueCents - refundCents - compensationCents - manualCostCents,
      netContribution: ((revenueCents - refundCents - compensationCents - manualCostCents) / 100).toFixed(2),
      complaintCount: adjustmentByType.get("complaint_record")?._count || 0,
      impressions: impressions._sum.impressionCount || 0,
      clicks: clicks._sum.clickCount || 0,
    });
  } catch (error) { next(error); }
});

marketPromotionsRouter.post("/admin/promotions/orders/:id/adjustments", authRequired, validate(promotionAdjustmentSchema), async (req, res, next) => {
  try {
    ensureAdmin(req);
    const id = Number(req.params.id);
    const adjustment = await createPromotionAdjustment(prisma, {
      orderId: id,
      actorId: req.user!.userId,
      type: req.body.type,
      amountCents: req.body.amount === undefined ? 0 : promotionPriceCents(req.body.amount),
      extensionDays: req.body.extensionDays,
      reference: req.body.reference,
      note: req.body.note,
    });
    await logMarketAdminAction(prisma, {
      actorId: req.user!.userId,
      action: "promotion_adjustment",
      targetType: "promotion_order",
      targetId: id,
      summary: `登记推广售后调整 ${req.body.type}`,
      detail: { type: req.body.type, amountCents: adjustment.amountCents, extensionDays: adjustment.extensionDays, referenceSuffix: String(adjustment.reference || "").slice(-4), note: req.body.note },
    });
    const order = await prisma.promotionOrder.findUnique({ where: { id }, include: promotionOrderInclude });
    if (!order) throw Errors.notFound("推广订单不存在");
    await notifyPromotion(order.userId, "推广服务记录已更新", `${order.planName} 新增了一条人工售后记录，请在推广中心查看。该记录不会触发自动退款或自动开票。`, "/market/promotions", { promotionOrderId: id, adjustmentId: adjustment.id, type: adjustment.type });
    ok(res, serializePromotionOrder(order, true));
  } catch (error) { next(handlePromotionServiceError(error)); }
});

marketPromotionsRouter.get("/admin/operations", authRequired, async (req, res, next) => {
  try {
    ensureAdmin(req);
    const days = Number(req.query.days || 30);
    ok(res, await getMarketOperationsDashboard(days));
  } catch (error) { next(error); }
});

marketPromotionsRouter.get("/admin/promotions/orders", authRequired, async (req, res, next) => {
  try {
    ensureAdmin(req);
    await refreshExpiredPromotions();
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 20, 10, 100);
    const status = String(req.query.status || "").trim();
    const type = String(req.query.type || "").trim();
    const q = String(req.query.q || "").trim();
    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (q) where.OR = [{ outTradeNo: { contains: q, mode: "insensitive" } }, { planName: { contains: q, mode: "insensitive" } }, { user: { nickname: { contains: q, mode: "insensitive" } } }];
    const [list, total] = await Promise.all([
      prisma.promotionOrder.findMany({ where, include: promotionOrderInclude, orderBy: { createdAt: "desc" }, skip: (page - 1) * size, take: size }),
      prisma.promotionOrder.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((order) => serializePromotionOrder(order, true)) });
  } catch (error) { next(error); }
});

marketPromotionsRouter.patch("/admin/promotions/orders/:id", authRequired, validate(promotionOrderActionSchema), async (req, res, next) => {
  try {
    ensureAdmin(req);
    const id = Number(req.params.id);
    const row = req.body.action === "confirm"
      ? await confirmPromotionOrder(prisma, id, req.user!.userId, {
        adminNote: req.body.note,
        method: req.body.verificationMethod,
        reference: req.body.verificationReference,
        paymentCode: req.body.paymentCode,
        verifiedAmountCents: req.body.verifiedAmount === undefined ? null : promotionPriceCents(req.body.verifiedAmount),
      })
      : await rejectPromotionOrder(prisma, id, req.user!.userId, req.body.note);
    await logMarketAdminAction(prisma, {
      actorId: req.user!.userId,
      action: `promotion_${req.body.action}`,
      targetType: "promotion_order",
      targetId: id,
      summary: `${req.body.action === "confirm" ? "确认" : "驳回"}推广订单 ${row.outTradeNo}`,
      detail: { type: row.type, amountCents: row.amountCents, verificationMethod: row.verificationMethod, verificationReferenceSuffix: String(row.verificationReference || "").slice(-4), paymentCodeMatched: req.body.action === "confirm", note: req.body.note },
    });
    const rejectionContent = row.paymentSubmittedAt
      ? `${req.body.note || "推广申请未通过"}。该订单已提交付款确认，系统不会自动退款；请私下联系管理员确认退款安排。`
      : (req.body.note || "请检查推广对象或资料后重新申请。");
    await notifyPromotion(row.userId, req.body.action === "confirm" ? "推广已确认" : (row.paymentSubmittedAt ? "推广未通过，请联系退款" : "推广申请未通过"), req.body.action === "confirm" ? `${row.planName} 已开始生效，所有展示都会明确标注推广属性。` : rejectionContent, "/market/promotions", { promotionOrderId: row.id, status: row.status, refundContactRequired: req.body.action === "reject" && Boolean(row.paymentSubmittedAt) });
    const result = await prisma.promotionOrder.findUnique({ where: { id }, include: promotionOrderInclude });
    ok(res, serializePromotionOrder(result, true));
  } catch (error) { next(handlePromotionServiceError(error)); }
});

marketPromotionsRouter.patch("/admin/promotions/plans/:id", authRequired, validate(promotionPlanPatchSchema), async (req, res, next) => {
  try {
    ensureAdmin(req);
    const current = await prisma.promotionPlan.findUnique({ where: { id: Number(req.params.id) } });
    if (!current) throw Errors.notFound("推广方案不存在");
    if (["home_featured", "wanted_urgent"].includes(current.type) && req.body.maxActive !== undefined && req.body.maxActive !== 8) {
      throw Errors.badRequest("首页商品推广和热议求购推广容量固定为 8 个");
    }
    const data: any = { ...req.body };
    delete data.price;
    delete data.manualCost;
    if (req.body.price !== undefined) data.priceCents = promotionPriceCents(req.body.price);
    if (req.body.manualCost !== undefined) data.manualCostCents = promotionPriceCents(req.body.manualCost);
    const row = await prisma.promotionPlan.update({ where: { id: current.id }, data });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "promotion_plan_update", targetType: "promotion_plan", targetId: row.id, summary: `更新推广方案 ${row.name}`, detail: data });
    ok(res, serializePromotionPlan(row));
  } catch (error) { next(error); }
});

marketPromotionsRouter.get("/admin/merchants", authRequired, async (req, res, next) => {
  try {
    ensureAdmin(req);
    await refreshExpiredPromotions();
    const status = String(req.query.status || "").trim();
    const where = status ? { status } : {};
    const list = await prisma.merchantProfile.findMany({ where, include: merchantInclude(), orderBy: { updatedAt: "desc" }, take: 200 });
    ok(res, list.map((row) => serializeMerchant(row, undefined, true)));
  } catch (error) { next(error); }
});

marketPromotionsRouter.patch("/admin/merchants/:id", authRequired, validate(merchantReviewSchema), async (req, res, next) => {
  try {
    ensureAdmin(req);
    const id = Number(req.params.id);
    const current = await prisma.merchantProfile.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("商户资料不存在");
    const now = new Date();
    let activePromotionOrderId: number | null = current.activePromotionOrderId;
    let activeUntil: Date | null = current.activeUntil;
    if (req.body.status === "approved") {
      const activeOrder = await prisma.promotionOrder.findFirst({
        where: { merchantProfileId: id, type: "merchant_homepage", status: "confirmed", startsAt: { lte: now }, expiresAt: { gt: now } },
        orderBy: { expiresAt: "desc" },
      });
      activePromotionOrderId = activeOrder?.id || null;
      activeUntil = activeOrder?.expiresAt || null;
    } else {
      activePromotionOrderId = null;
      activeUntil = null;
    }
    const row = await prisma.merchantProfile.update({
      where: { id },
      data: {
        status: req.body.status,
        reviewNote: req.body.note,
        reviewedById: req.user!.userId,
        reviewedAt: now,
        reviewDueAt: req.body.status === "approved" ? new Date(now.getTime() + 90 * 24 * 60 * 60_000) : null,
        reviewReminderSentAt: null,
        activePromotionOrderId,
        activeUntil,
      },
      include: merchantInclude(),
    });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "merchant_review", targetType: "merchant_profile", targetId: id, summary: `商户资料更新为 ${req.body.status}`, detail: { note: req.body.note } });
    await notifyPromotion(current.userId, req.body.status === "approved" ? "商户资料审核通过" : "商户资料状态已更新", req.body.status === "approved" ? "你现在可以在“成为商户”页面申请合作商户主页方案。" : (req.body.note || "请查看商户资料状态。"), "/market/merchant/apply", { merchantProfileId: id, status: req.body.status });
    ok(res, serializeMerchant(row, undefined, true));
  } catch (error) { next(error); }
});
