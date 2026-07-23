import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger, queryPage, querySize } from "../utils/query";
import { config } from "../config";
import { isFeatureOn } from "../services/siteSettings";
import { ensureUserCanSpeak } from "../services/userModeration";
import {
  ensureUserCanSubmitTopic,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
} from "../services/topicAiReview";
import {
  amountCentsToMoney,
  buildEpaySubmitPayload,
  getEnabledEpayTypes,
  getEpayMerchantKey,
  moneyToAmountCents,
  resolvePaymentOrigin,
  verifyEpayParams,
  type EpayPayType,
} from "../services/epay";
import {
  categoryBelongsToCatalog,
  isLearningMaterialCategory,
  resolveMarketCategoryBoundary,
  splitMarketCategories,
  type MarketCatalogScope,
} from "../services/marketCatalog";
import { learningMaterialsRouter } from "./learningMaterials";
import { marketPromotionsRouter } from "./marketPromotions";
import { MARKET_PUBLIC_USER_SELECT } from "../services/marketPublicUser";
import { refreshExpiredPromotions, serializeItemPromotions, serializeMerchantPromotion, serializeWantedPromotion } from "../services/promotion";
import { toggleMarketItemFavorite } from "../services/marketCounters";
import {
  DIRECT_TRADE_NOTICE,
  MARKET_PAYMENT_DISABLED_MESSAGE,
  STUDENT_MARKET_PAYMENT_ENABLED,
  directTradeOrderAmounts,
} from "../services/marketPolicy";
import {
  addDays,
  nextIntentExpiry,
  nextReservationExpiry,
  nextWantedExpiry,
  sweepMarketLifecycle,
} from "../services/marketLifecycle";
import {
  ensureMarketAccess,
  evaluateMarketContent,
  getMarketTrustProfile,
  logMarketAdminAction,
  maskMarketContact,
  openMarketContact,
  sealMarketContact,
  type MarketAccessAction,
} from "../services/marketTrust";
import {
  findMatchesForItem,
  findMatchesForWanted,
  notifyMatchesForItem,
  notifyMatchesForWanted,
} from "../services/marketMatching";
import { WANTED_DEMAND_BOARD_SLUG } from "../services/defaultBoardCatalog";
import {
  ensureWantedDemandBoard,
  refreshWantedDemandTopicStats,
  syncPersistedWantedDemandTopic,
  syncWantedDemandTopic,
} from "../services/wantedDemandTopic";
import {
  isMarketCampus,
  MARKET_CAMPUSES,
  marketCampusStorageAliases,
  normalizeMarketCampus,
} from "../services/marketCampus";
import { consumeAnonymousCredit, createAnonymousAlias } from "../services/userTrust";

export const marketRouter = Router();
marketRouter.use(authOptional);
marketRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

const ITEM_CONDITIONS = ["new", "like_new", "good", "fair"] as const;
const TRADE_MODES = ["meetup", "shipping", "online", "any"] as const;
const LISTING_TYPES = ["sell", "wanted"] as const;
const ITEM_STATUSES = ["draft", "reviewing", "active", "negotiating", "reserved", "sold", "withdrawn", "expired", "hidden", "targeted"] as const;
const PRIVATE_ITEM_STATUSES = new Set(["draft", "reviewing", "hidden"]);
const PAY_TYPES = ["alipay", "wxpay", "qqpay", "bank", "jdpay"] as const;
const MARKET_CONFIG_ID = 1;
const DEFAULT_COMMISSION_BPS = 0;
const DEFAULT_LEARNING_MATERIAL_COMMISSION_BPS = 0;
const PRIVATE_TRADE_STATUSES = ["reserved", "paid", "delivering", "completed", "disputed", "no_show"];
const DEFAULT_CATEGORIES = [
  { slug: "digital", name: "数码 3C", icon: "💻", description: "手机、电脑、数码配件", fulfillmentType: "physical", imageRequired: true, sort: 10 },
  { slug: "books", name: "教材书籍", icon: "📚", description: "教材、课外书与纸质资料", fulfillmentType: "physical", imageRequired: true, sort: 20 },
  { slug: "digital_goods", name: "免费原创", icon: "📁", description: "同学原创、已获授权或基于公开资料整理的免费学习内容", fulfillmentType: "digital", imageRequired: false, enabled: true, sort: 30 },
  { slug: "dorm", name: "宿舍用品", icon: "🛏️", description: "宿舍与日常生活用品", fulfillmentType: "physical", imageRequired: true, sort: 40 },
  { slug: "appliance", name: "小家电", icon: "🔌", description: "小型电器与配件", fulfillmentType: "physical", imageRequired: true, sort: 50 },
  { slug: "fashion", name: "服饰鞋包", icon: "👕", description: "服饰、鞋履与箱包", fulfillmentType: "physical", imageRequired: true, sort: 60 },
  { slug: "sports", name: "运动户外", icon: "🏸", description: "运动器材与户外用品", fulfillmentType: "physical", imageRequired: true, sort: 70 },
  { slug: "tickets", name: "票务卡券", icon: "🎫", description: "合规票券与校园卡券", fulfillmentType: "physical", imageRequired: true, sort: 80 },
  { slug: "other", name: "其他商品", icon: "📦", description: "未归入其他分类的商品", fulfillmentType: "physical", imageRequired: true, sort: 90 },
] as const;

const itemInclude: any = {
  seller: { select: MARKET_PUBLIC_USER_SELECT },
  images: { orderBy: [{ sort: "asc" as const }, { id: "asc" as const }] },
  topic: { select: { id: true, replyCount: true, likeCount: true, hidden: true, aiReviewStatus: true } },
  pinnedPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
  homePromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
  _count: { select: { favorites: true, offers: true, tradeIntents: true } },
} as const;

const imageUrlSchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  "图片地址格式不正确",
);

const optionalMarketCampusSchema = z.preprocess(
  normalizeMarketCampus,
  z.union([z.enum(MARKET_CAMPUSES), z.literal("")]),
);
const requiredMarketCampusSchema = z.preprocess(
  normalizeMarketCampus,
  z.enum(MARKET_CAMPUSES, { errorMap: () => ({ message: "校区仅支持 SIP 或 TC" }) }),
);

function normalizeMarketTradeMode(value: unknown) {
  const input = String(value ?? "").trim();
  return input === "both" ? "any" : input;
}

const marketTradeModeSchema = z.preprocess(normalizeMarketTradeMode, z.enum(TRADE_MODES));

function queryMarketCampus(value: unknown) {
  const campus = normalizeMarketCampus(value);
  if (!campus) return "";
  if (!isMarketCampus(campus)) throw Errors.badRequest("校区仅支持 SIP 或 TC");
  return campus;
}

const itemInputSchema = z.object({
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
  contactVisibility: z.literal("after_accept").optional().default("after_accept"),
  images: z.array(imageUrlSchema).max(9).optional().default([]),
  digitalDelivery: z.string().trim().max(10000).optional().default(""),
  draft: z.boolean().optional().default(false),
});

const itemPatchSchema = itemInputSchema.partial().extend({
  status: z.enum(ITEM_STATUSES).optional(),
});

function requestOrigin(req: any) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

function cents(value: string | number | null | undefined, allowZero = true) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount <= 0)) throw Errors.badRequest("价格格式不正确");
  return Math.round(amount * 100);
}

function extractImagesFromContent(content: string) {
  const urls: string[] = [];
  for (const match of content.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }
  for (const match of content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }
  return urls.slice(0, 9);
}

function nextMarketTradeNo(userId: number) {
  return `MK${Date.now()}U${userId}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function serializeItem(item: any, viewerId?: number) {
  return {
    id: item.id,
    topicId: item.topicId,
    sellerId: item.sellerId,
    listingType: item.listingType,
    title: item.title,
    description: item.description,
    category: item.category,
    deliveryType: item.deliveryType || "physical",
    hasDigitalDelivery: Boolean(item.digitalDeliveryEncrypted),
    price: amountCentsToMoney(item.priceCents),
    priceCents: item.priceCents,
    originalPrice: item.originalPriceCents === null ? null : amountCentsToMoney(item.originalPriceCents),
    originalPriceCents: item.originalPriceCents,
    negotiable: item.negotiable,
    condition: item.condition,
    tradeMode: normalizeMarketTradeMode(item.tradeMode) || "meetup",
    campus: item.campus,
    location: item.location,
    brand: item.brand || "",
    model: item.model || "",
    usageDuration: item.usageDuration || "",
    flaws: item.flaws || "",
    accessories: item.accessories || "",
    testAllowed: item.testAllowed !== false,
    availableTime: item.availableTime || "",
    contactVisibility: item.contactVisibility || "after_accept",
    expiresAt: item.expiresAt,
    renewedAt: item.renewedAt,
    visibility: item.visibility || "public",
    status: item.status,
    viewCount: item.viewCount,
    favoriteCount: item._count?.favorites ?? item.favoriteCount ?? 0,
    offerCount: item._count?.tradeIntents ?? item._count?.offers ?? item.offerCount ?? 0,
    images: (item.images || []).map((image: any) => ({ id: image.id, url: image.url, sort: image.sort })),
    cover: item.images?.[0]?.url || extractImagesFromContent(item.description || "")[0] || "",
    seller: item.seller,
    topic: item.topic,
    favorited: Array.isArray(item.favorites) ? item.favorites.some((favorite: any) => favorite.userId === viewerId) : false,
    mine: Boolean(viewerId && viewerId === item.sellerId),
    soldAt: item.soldAt,
    promotions: serializeItemPromotions(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function serializeOrder(order: any, viewerId?: number, viewerRole?: string) {
  const { digitalDeliveryEncrypted, meetupReminderSentAt: _meetupReminderSentAt, ...safeOrder } = order;
  const canSeeDigitalDelivery = Boolean(
    digitalDeliveryEncrypted
    && ["paid", "delivering", "completed", "refund_pending", "disputed"].includes(order.status)
    && (viewerId === order.buyerId || viewerId === order.sellerId || ["admin", "mod"].includes(viewerRole || "")),
  );
  let digitalDelivery: string | null = null;
  if (canSeeDigitalDelivery) {
    try { digitalDelivery = openSensitive(digitalDeliveryEncrypted); } catch { digitalDelivery = null; }
  }
  return {
    ...safeOrder,
    amount: amountCentsToMoney(order.amountCents),
    platformFee: amountCentsToMoney(order.platformFeeCents),
    sellerAmount: amountCentsToMoney(order.sellerAmountCents),
    digitalDelivery,
  };
}

async function ensureMarketCategories() {
  await Promise.all(DEFAULT_CATEGORIES.map((category) => prisma.marketCategory.upsert({
    where: { slug: category.slug },
    update: category.slug === "digital_goods" ? { name: category.name, description: category.description, icon: category.icon, enabled: true } : {},
    create: category,
  })));
}

function requestIp(req: any) {
  return String(req.headers?.["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function serializeTradeIntent(intent: any) {
  return {
    ...intent,
    price: amountCentsToMoney(intent.proposedPriceCents),
  };
}

function serializeWantedPost(post: any, viewerId?: number) {
  const { moderationNote, moderatedAt, linkedTopics, ...safePost } = post;
  const topicId = linkedTopics?.[0]?.id ?? post.topicId ?? null;
  const isAnonymous = Boolean(post.isAnonymous);
  const anonymousAlias = isAnonymous ? (post.anonymousAlias || "匿名同学") : null;
  const publicAuthor = isAnonymous ? {
    id: null,
    nickname: anonymousAlias,
    avatar: null,
    role: "anonymous",
    studentSso: false,
    anonymous: true,
  } : post.author;
  return {
    ...safePost,
    authorId: isAnonymous ? null : post.authorId,
    author: publicAuthor,
    isAnonymous,
    anonymousAlias,
    budgetMin: amountCentsToMoney(post.budgetMinCents),
    budgetMax: amountCentsToMoney(post.budgetMaxCents),
    responseCount: post._count?.responses ?? post.responseCount ?? 0,
    mine: Boolean(viewerId && post.authorId === viewerId),
    moderationNote: viewerId === post.authorId ? moderationNote : undefined,
    moderatedAt: viewerId === post.authorId ? moderatedAt : undefined,
    promotion: serializeWantedPromotion(post),
    topicId,
    topicUrl: topicId ? `/forum/topic/${topicId}` : null,
  };
}

const wantedDemandTopicInclude = {
  where: { board: { is: { slug: WANTED_DEMAND_BOARD_SLUG } } },
  select: { id: true },
  orderBy: { id: "asc" as const },
  take: 1,
};

function serializeWantedResponse(response: any) {
  return {
    ...response,
    price: amountCentsToMoney(response.priceCents),
    item: response.item ? serializeItem(response.item, response.sellerId) : response.item,
  };
}

async function getMarketCategory(slug: string, includeDisabled = false) {
  await ensureMarketCategories();
  const category = await prisma.marketCategory.findUnique({ where: { slug } });
  if (!category || (!includeDisabled && !category.enabled)) throw Errors.badRequest("请选择有效的商品品类");
  return category;
}

async function getMarketConfig() {
  return prisma.marketConfig.upsert({
    where: { id: MARKET_CONFIG_ID },
    update: { commissionBps: 0, learningMaterialCommissionBps: 0 },
    create: { id: MARKET_CONFIG_ID, commissionBps: DEFAULT_COMMISSION_BPS, learningMaterialCommissionBps: DEFAULT_LEARNING_MATERIAL_COMMISSION_BPS },
  });
}

function serializeMarketConfig(config: { commissionBps: number; learningMaterialCommissionBps: number; updatedAt: Date }) {
  return {
    commissionBps: config.commissionBps,
    commissionRate: config.commissionBps / 100,
    learningMaterialCommissionBps: config.learningMaterialCommissionBps,
    learningMaterialCommissionRate: config.learningMaterialCommissionBps / 100,
    updatedAt: config.updatedAt,
  };
}

async function requireVerifiedMarketUser(userId: number, role: string, action: MarketAccessAction = "trade") {
  if (!isFeatureOn("market")) throw Errors.forbidden("市集当前已关闭");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, studentSso: true, forumEnabled: true, status: true, topicSubmissionLocked: true },
  });
  if (!user) throw Errors.unauthorized();
  if (role !== "admin" && role !== "mod" && !user.studentSso) throw Errors.forbidden("仅限通过 XJTLU 统一认证的用户使用商城");
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  await ensureMarketAccess(prisma, userId, action, role);
  return user;
}

async function notify(userId: number, title: string, content: string, link: string, payload: Record<string, unknown>) {
  await prisma.notification.create({
    data: {
      userId,
      category: "market",
      level: "normal",
      title,
      content,
      link,
      source: "靠浦校园市集",
      payload: JSON.stringify(payload),
    },
  }).catch(() => null);
}

async function closeExpiredMarketOrders() {
  await Promise.all([sweepMarketLifecycle(prisma), refreshExpiredPromotions()]);
}

marketRouter.get("/meta", async (_req, res, next) => {
  try {
    await ensureMarketCategories();
    const marketConfig = await getMarketConfig();
    const allCategories = await prisma.marketCategory.findMany({ where: { enabled: true }, orderBy: [{ sort: "asc" }, { id: "asc" }] });
    const { market: categories } = splitMarketCategories(allCategories);
    ok(res, {
      categories,
      campuses: MARKET_CAMPUSES,
      featuredLearningMaterials: null,
      conditions: ITEM_CONDITIONS,
      tradeModes: TRADE_MODES,
      listingTypes: LISTING_TYPES,
      payTypes: [],
      paymentEnabled: STUDENT_MARKET_PAYMENT_ENABLED,
      ...serializeMarketConfig(marketConfig),
    });
  } catch (error) { next(error); }
});
marketRouter.use("/materials", learningMaterialsRouter);
marketRouter.use("/", marketPromotionsRouter);

const marketPreferenceSchema = z.object({
  matchNotificationsEnabled: z.boolean(),
  meetupRemindersEnabled: z.boolean(),
}).strict();

marketRouter.get("/preferences", authRequired, async (req, res, next) => {
  try {
    const preference = await prisma.marketPreference.upsert({
      where: { userId: req.user!.userId },
      create: { userId: req.user!.userId },
      update: {},
    });
    ok(res, preference);
  } catch (error) { next(error); }
});

marketRouter.patch("/preferences", authRequired, validate(marketPreferenceSchema), async (req, res, next) => {
  try {
    const preference = await prisma.marketPreference.upsert({
      where: { userId: req.user!.userId },
      create: { userId: req.user!.userId, ...req.body },
      update: req.body,
    });
    ok(res, preference);
  } catch (error) { next(error); }
});

const wantedInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  budgetMin: z.union([z.string(), z.number()]),
  budgetMax: z.union([z.string(), z.number()]),
  brandModel: z.string().trim().max(160).optional().default(""),
  condition: z.string().trim().max(120).optional().default(""),
  expectedTradeTime: z.string().trim().min(1).max(300),
  campus: requiredMarketCampusSchema,
  location: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(10000),
  allowSellerOffers: z.boolean().optional().default(true),
  anonymous: z.boolean().optional().default(false),
  expiryDays: z.number().int().min(7).max(60).optional().default(21),
});
const wantedPatchSchema = wantedInputSchema.omit({ anonymous: true }).partial();

marketRouter.get("/wanted", async (req, res, next) => {
  try {
    if (!isFeatureOn("market")) throw Errors.forbidden("市集当前已关闭");
    await closeExpiredMarketOrders();
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 24, 8, 60);
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const campus = queryMarketCampus(req.query.campus);
    const status = String(req.query.status || "").trim();
    if (status && !["active", "responded"].includes(status)) {
      throw Errors.badRequest("公开求购列表只能查询进行中的需求");
    }
    const where: any = status ? { status } : { status: { in: ["active", "responded"] } };
    if (category) where.category = category;
    if (campus) where.campus = { in: marketCampusStorageAliases(campus), mode: "insensitive" };
    if (q) where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { brandModel: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
    ];
    const [list, total] = await Promise.all([
      prisma.wantedPost.findMany({
        where,
        include: { author: { select: MARKET_PUBLIC_USER_SELECT }, urgentPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } }, linkedTopics: wantedDemandTopicInclude, _count: { select: { responses: true } } },
        orderBy: [{ urgentUntil: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.wantedPost.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((post) => serializeWantedPost(post, req.user?.userId)) });
  } catch (error) { next(error); }
});

marketRouter.get("/wanted/:id", async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("求购 ID 不合法");
    const post = await prisma.wantedPost.findUnique({
      where: { id },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        urgentPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
        _count: { select: { responses: true } },
        linkedTopics: wantedDemandTopicInclude,
        responses: {
          include: { seller: { select: MARKET_PUBLIC_USER_SELECT }, item: { include: itemInclude }, reservation: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!post) throw Errors.notFound("求购不存在");
    const isOwner = post.authorId === req.user?.userId;
    const isStaff = ["admin", "mod"].includes(req.user?.role || "");
    if (["reviewing", "removed"].includes(post.status) && !isOwner && !isStaff) throw Errors.notFound("求购不存在");
    const visibleResponses = isOwner || isStaff
      ? post.responses
      : post.responses.filter((response) => response.sellerId === req.user?.userId);
    ok(res, {
      ...serializeWantedPost(post, req.user?.userId),
      responses: visibleResponses.map(serializeWantedResponse),
    });
  } catch (error) { next(error); }
});

marketRouter.get("/wanted/:id/matches", async (req, res, next) => {
  try {
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("求购 ID 不合法");
    const wanted = await prisma.wantedPost.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!wanted || !["active", "responded"].includes(wanted.status)) throw Errors.notFound("求购不存在或已结束");
    const matches = await findMatchesForWanted(id, 8);
    const rows = await prisma.marketItem.findMany({
      where: { id: { in: matches.map((match) => match.item.id) } },
      include: {
        ...itemInclude,
        favorites: req.user ? { where: { userId: req.user.userId }, select: { userId: true } } : false,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    ok(res, matches.flatMap((match) => {
      const item = byId.get(match.item.id);
      return item ? [{ item: serializeItem(item, req.user?.userId), score: match.score, reasons: match.reasons }] : [];
    }));
  } catch (error) { next(error); }
});

marketRouter.post("/wanted", authRequired, validate(wantedInputSchema), async (req, res, next) => {
  try {
    const authorId = req.user!.userId;
    await requireVerifiedMarketUser(authorId, req.user!.role, "publish");
    await ensureUserCanSpeak(authorId);
    await ensureUserCanSubmitTopic(authorId);
    const input = req.body as z.infer<typeof wantedInputSchema>;
    const category = await getMarketCategory(input.category);
    if (category.fulfillmentType !== "physical") throw Errors.badRequest("求购只支持实体物品");
    const budgetMinCents = cents(input.budgetMin) ?? 0;
    const budgetMaxCents = cents(input.budgetMax) ?? 0;
    if (budgetMaxCents <= 0 || budgetMinCents > budgetMaxCents) throw Errors.badRequest("预算范围不正确");
    const safety = await evaluateMarketContent(prisma, [input.title, input.description, input.brandModel, input.location]);
    if (safety.action === "block") throw Errors.badRequest("求购内容包含市集禁售或高风险信息，请修改后再发布");
    const bypass = await shouldBypassAiReviewForUser(authorId, req.user!.role);
    const review = shouldRunAiReview() && !bypass
      ? await reviewTopicContent({ title: input.title, content: input.description, boardName: "市集求购", boardType: "market", metadata: { wantedPost: true, category: input.category } })
      : null;
    const reviewing = safety.action === "review" || review?.status === "blocked_ai";
    const wantedBoard = await ensureWantedDemandBoard();
    if (input.anonymous && !wantedBoard.anonymousEnabled) throw Errors.forbidden("求购需求暂未开放匿名发布");
    const anonymousAlias = input.anonymous ? createAnonymousAlias() : null;
    const { post, topic } = await prisma.$transaction(async (tx) => {
      if (input.anonymous) await consumeAnonymousCredit(authorId, tx);
      const createdPost = await tx.wantedPost.create({
        data: {
          authorId,
          isAnonymous: input.anonymous,
          anonymousAlias,
          title: input.title,
          category: input.category,
          budgetMinCents,
          budgetMaxCents,
          brandModel: input.brandModel,
          condition: input.condition,
          expectedTradeTime: input.expectedTradeTime,
          campus: input.campus,
          location: input.location,
          description: input.description,
          allowSellerOffers: input.allowSellerOffers,
          status: reviewing ? "reviewing" : "active",
          expiresAt: addDays(new Date(), input.expiryDays),
        },
        include: { author: { select: MARKET_PUBLIC_USER_SELECT }, _count: { select: { responses: true } } },
      });
      const createdTopic = await syncWantedDemandTopic(tx, createdPost, review ? {
        status: review.status,
        riskLevel: review.riskLevel,
        riskScore: review.riskScore,
        reason: review.reason,
        detail: review.detail,
        model: review.model,
        reviewedAt: new Date(),
      } : {});
      return { post: { ...createdPost, linkedTopics: [{ id: createdTopic.id }] }, topic: createdTopic };
    });
    await refreshWantedDemandTopicStats(topic, authorId);
    if (post.status === "active") await notifyMatchesForWanted(post.id).catch((error) => console.warn("[market] wanted matching notification failed", error));
    ok(res, {
      ...serializeWantedPost(post, authorId),
      review: review ? { status: review.status, reason: review.reason } : null,
      safetyReview: safety.action === "review" ? { status: "reviewing", reason: "公开内容包含联系方式或需人工复核的信息" } : null,
    });
  } catch (error) { next(error); }
});

marketRouter.patch("/wanted/:id", authRequired, validate(wantedPatchSchema), async (req, res, next) => {
  try {
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("求购 ID 不合法");
    const current = await prisma.wantedPost.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("求购不存在");
    if (current.authorId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    if (!["active", "responded", "expired"].includes(current.status)) throw Errors.badRequest("当前求购不能编辑");
    if (!["admin", "mod"].includes(req.user!.role)) await requireVerifiedMarketUser(req.user!.userId, req.user!.role, "publish");
    const input = req.body as z.infer<typeof wantedPatchSchema>;
    const data: any = { ...input };
    delete data.budgetMin;
    delete data.budgetMax;
    delete data.expiryDays;
    if (input.category) {
      const category = await getMarketCategory(input.category);
      if (category.fulfillmentType !== "physical") throw Errors.badRequest("求购只支持实体物品");
    }
    if (input.budgetMin !== undefined) data.budgetMinCents = cents(input.budgetMin) ?? 0;
    if (input.budgetMax !== undefined) data.budgetMaxCents = cents(input.budgetMax) ?? 0;
    const finalMin = data.budgetMinCents ?? current.budgetMinCents;
    const finalMax = data.budgetMaxCents ?? current.budgetMaxCents;
    if (finalMax <= 0 || finalMin > finalMax) throw Errors.badRequest("预算范围不正确");
    const safety = await evaluateMarketContent(prisma, [
      input.title ?? current.title,
      input.description ?? current.description,
      input.brandModel ?? current.brandModel,
      input.location ?? current.location,
    ]);
    if (safety.action === "block") throw Errors.badRequest("求购内容包含市集禁售或高风险信息，请修改后再发布");
    if (input.expiryDays) data.expiresAt = addDays(new Date(), input.expiryDays);
    if (current.status === "expired") data.status = "active";
    if (safety.action === "review") data.status = "reviewing";
    const updated = await prisma.wantedPost.update({ where: { id }, data, include: { author: { select: MARKET_PUBLIC_USER_SELECT }, _count: { select: { responses: true } } } });
    const topic = await syncPersistedWantedDemandTopic(updated);
    ok(res, serializeWantedPost({ ...updated, topicId: topic.id }, req.user!.userId));
  } catch (error) { next(error); }
});

const wantedLifecycleSchema = z.object({ action: z.enum(["renew", "cancel", "complete"]) });
marketRouter.post("/wanted/:id/lifecycle", authRequired, validate(wantedLifecycleSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.wantedPost.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("求购不存在");
    if (current.authorId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    const action = req.body.action as z.infer<typeof wantedLifecycleSchema>["action"];
    if (action === "renew" && !["admin", "mod"].includes(req.user!.role)) {
      await requireVerifiedMarketUser(req.user!.userId, req.user!.role, "publish");
      const safety = await evaluateMarketContent(prisma, [current.title, current.description, current.brandModel, current.location]);
      if (safety.action === "block") throw Errors.badRequest("求购内容包含市集禁售或高风险信息，请编辑后再续期");
      if (safety.action === "review") {
        const updated = await prisma.wantedPost.update({ where: { id }, data: { status: "reviewing", expiresAt: nextWantedExpiry() }, include: { author: { select: MARKET_PUBLIC_USER_SELECT }, _count: { select: { responses: true } } } });
        const topic = await syncPersistedWantedDemandTopic(updated);
        return ok(res, serializeWantedPost({ ...updated, topicId: topic.id }, req.user!.userId));
      }
    }
    const data = action === "renew"
      ? { status: "active", expiresAt: nextWantedExpiry() }
      : action === "complete" ? { status: "completed" } : { status: "cancelled" };
    if (action === "renew" && !["active", "responded", "expired", "cancelled"].includes(current.status)) throw Errors.badRequest("当前求购不能续期");
    const updated = await prisma.$transaction(async (tx) => {
      const post = await tx.wantedPost.update({ where: { id }, data, include: { author: { select: MARKET_PUBLIC_USER_SELECT }, _count: { select: { responses: true } } } });
      if (action !== "renew") {
        await tx.wantedResponse.updateMany({ where: { wantedPostId: id, status: "pending" }, data: { status: "expired" } });
        await tx.marketItem.updateMany({ where: { sourceWantedPostId: id, visibility: "targeted", status: "targeted" }, data: { status: "withdrawn" } });
      }
      return post;
    });
    const topic = await syncPersistedWantedDemandTopic(updated);
    ok(res, serializeWantedPost({ ...updated, topicId: topic.id }, req.user!.userId));
  } catch (error) { next(error); }
});

const wantedResponseSchema = z.object({
  itemId: z.number().int().positive().optional(),
  title: z.string().trim().min(2).max(120).optional(),
  price: z.union([z.string(), z.number()]),
  description: z.string().trim().min(1).max(5000),
  images: z.array(imageUrlSchema).max(9).optional().default([]),
  condition: z.enum(["new", "like_new", "good", "fair"]).optional().default("good"),
  brand: z.string().trim().max(80).optional().default(""),
  model: z.string().trim().max(80).optional().default(""),
  availableTime: z.string().trim().min(1).max(300),
});

marketRouter.post("/wanted/:id/responses", authRequired, validate(wantedResponseSchema), async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const wantedPostId = Number(req.params.id);
    const sellerId = req.user!.userId;
    await requireVerifiedMarketUser(sellerId, req.user!.role, "publish");
    await ensureUserCanSpeak(sellerId);
    const wanted = await prisma.wantedPost.findUnique({ where: { id: wantedPostId } });
    if (!wanted || !["active", "responded"].includes(wanted.status) || wanted.expiresAt <= new Date()) throw Errors.badRequest("该求购当前不接受响应");
    if (!wanted.allowSellerOffers) throw Errors.badRequest("发布者暂不接受卖家主动报价");
    if (wanted.authorId === sellerId) throw Errors.badRequest("不能响应自己发布的求购");
    const duplicate = await prisma.wantedResponse.findFirst({ where: { wantedPostId, sellerId, status: "pending" } });
    if (duplicate) throw Errors.conflict("你已经提交过待处理的响应");
    const priceCents = cents(req.body.price, false)!;
    const safety = await evaluateMarketContent(prisma, [req.body.title, req.body.description, req.body.brand, req.body.model]);
    if (safety.action !== "allow") throw Errors.badRequest("响应内容请勿包含禁售物品或联系方式；卖家接受后系统会开放联系方式");
    let existingItem: any = null;
    if (req.body.itemId) {
      existingItem = await prisma.marketItem.findUnique({ where: { id: req.body.itemId } });
      if (!existingItem || existingItem.sellerId !== sellerId || existingItem.status !== "active" || existingItem.visibility !== "public" || existingItem.deliveryType !== "physical") {
        throw Errors.badRequest("请选择自己当前在售的实体商品");
      }
    } else if (!req.body.title || !req.body.images.length) {
      throw Errors.badRequest("未关联在售商品时，请填写商品名称并上传至少一张实拍图");
    }
    const response = await prisma.$transaction(async (tx) => {
      const item = existingItem || await tx.marketItem.create({
        data: {
          sellerId,
          listingType: "sell",
          title: req.body.title,
          description: req.body.description,
          category: wanted.category,
          deliveryType: "physical",
          priceCents,
          negotiable: false,
          condition: req.body.condition,
          tradeMode: "meetup",
          campus: wanted.campus,
          location: wanted.location,
          brand: req.body.brand,
          model: req.body.model,
          availableTime: req.body.availableTime,
          contactVisibility: "after_accept",
          expiresAt: wanted.expiresAt,
          visibility: "targeted",
          sourceWantedPostId: wantedPostId,
          status: "targeted",
          images: { create: req.body.images.map((url: string, sort: number) => ({ url, sort })) },
        },
      });
      const created = await tx.wantedResponse.create({
        data: { wantedPostId, sellerId, itemId: item.id, priceCents, description: req.body.description, availableTime: req.body.availableTime },
        include: { seller: { select: MARKET_PUBLIC_USER_SELECT }, item: { include: itemInclude }, reservation: true },
      });
      await tx.wantedPost.updateMany({ where: { id: wantedPostId, status: "active" }, data: { status: "responded" } });
      return created;
    });
    await notify(wanted.authorId, "求购收到新响应", `有同学以 ¥${amountCentsToMoney(priceCents)} 响应了「${wanted.title}」`, `/market/wanted/${wantedPostId}`, { type: "wanted-response", wantedPostId, responseId: response.id });
    ok(res, serializeWantedResponse(response));
  } catch (error) { next(error); }
});

const wantedResponseActionSchema = z.object({ action: z.enum(["accept", "reject", "cancel"]) });
marketRouter.patch("/wanted-responses/:id", authRequired, validate(wantedResponseActionSchema), async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = Number(req.params.id);
    const response = await prisma.wantedResponse.findUnique({ where: { id }, include: { wantedPost: true, item: true } });
    if (!response) throw Errors.notFound("求购响应不存在");
    if (response.status !== "pending") throw Errors.badRequest("该响应已经处理");
    const action = req.body.action as z.infer<typeof wantedResponseActionSchema>["action"];
    if (action === "cancel") {
      if (response.sellerId !== req.user!.userId) throw Errors.forbidden();
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.wantedResponse.update({ where: { id }, data: { status: "cancelled" }, include: { seller: { select: MARKET_PUBLIC_USER_SELECT }, item: { include: itemInclude }, reservation: true } });
        if (response.item.visibility === "targeted") await tx.marketItem.update({ where: { id: response.itemId }, data: { status: "withdrawn" } });
        return row;
      });
      return ok(res, serializeWantedResponse(updated));
    }
    if (response.wantedPost.authorId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    if (action === "reject") {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.wantedResponse.update({ where: { id }, data: { status: "rejected" }, include: { seller: { select: MARKET_PUBLIC_USER_SELECT }, item: { include: itemInclude }, reservation: true } });
        if (response.item.visibility === "targeted") await tx.marketItem.update({ where: { id: response.itemId }, data: { status: "withdrawn" } });
        return row;
      });
      await notify(response.sellerId, "求购响应未被接受", `你对「${response.wantedPost.title}」的响应暂未被接受`, `/market/wanted/${response.wantedPostId}`, { type: "wanted-response-rejected", wantedPostId: response.wantedPostId, responseId: id });
      return ok(res, serializeWantedResponse(updated));
    }
    if (!["active", "responded"].includes(response.wantedPost.status)) throw Errors.badRequest("求购当前不可匹配");
    const allowedItemStatus = response.item.visibility === "targeted" ? "targeted" : "active";
    if (response.item.status !== allowedItemStatus) throw Errors.badRequest("响应商品当前不可预订");
    const amounts = directTradeOrderAmounts(response.priceCents);
    const reservation = await prisma.$transaction(async (tx) => {
      const reserved = await tx.marketItem.updateMany({ where: { id: response.itemId, status: allowedItemStatus }, data: { status: "reserved" } });
      if (reserved.count !== 1) throw Errors.conflict("响应商品已不可预订");
      await tx.wantedResponse.update({ where: { id }, data: { status: "accepted" } });
      await tx.wantedResponse.updateMany({ where: { wantedPostId: response.wantedPostId, id: { not: id }, status: "pending" }, data: { status: "rejected" } });
      await tx.wantedPost.update({ where: { id: response.wantedPostId }, data: { status: "matched" } });
      await tx.tradeIntent.updateMany({ where: { itemId: response.itemId, status: "pending" }, data: { status: "rejected" } });
      const created = await tx.marketOrder.create({
        data: {
          itemId: response.itemId,
          wantedPostId: response.wantedPostId,
          wantedResponseId: id,
          buyerId: response.wantedPost.authorId,
          sellerId: response.sellerId,
          outTradeNo: nextMarketTradeNo(response.wantedPost.authorId),
          amountCents: response.priceCents,
          platformFeeCents: amounts.platformFeeCents,
          sellerAmountCents: amounts.sellerAmountCents,
          deliveryType: "physical",
          status: "reserved",
          expiresAt: nextReservationExpiry(),
        },
      });
      await tx.marketConversation.upsert({
        where: { itemId_buyerId_sellerId: { itemId: response.itemId, buyerId: response.wantedPost.authorId, sellerId: response.sellerId } },
        create: { itemId: response.itemId, orderId: created.id, buyerId: response.wantedPost.authorId, sellerId: response.sellerId },
        update: { orderId: created.id },
      });
      await tx.marketItem.updateMany({
        where: { sourceWantedPostId: response.wantedPostId, visibility: "targeted", id: { not: response.itemId }, status: "targeted" },
        data: { status: "withdrawn" },
      });
      return created;
    });
    await notify(response.sellerId, "求购响应已被接受", `「${response.wantedPost.title}」已匹配，请在 72 小时内与买家约定校内见面。`, "/market/mine?tab=reservations", { type: "wanted-response-accepted", wantedPostId: response.wantedPostId, reservationId: reservation.id });
    ok(res, serializeOrder(reservation, req.user!.userId, req.user!.role));
  } catch (error) { next(error); }
});

async function listMarketItems(req: any, res: any, next: any, scope: MarketCatalogScope) {
  try {
    if (!isFeatureOn("market")) throw Errors.forbidden("市集当前已关闭");
    await closeExpiredMarketOrders();
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 24, 8, 60);
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const listingType = String(req.query.listingType || "").trim();
    const condition = String(req.query.condition || "").trim();
    const tradeMode = normalizeMarketTradeMode(req.query.tradeMode);
    const campus = queryMarketCampus(req.query.campus);
    const minPrice = req.query.minPrice === undefined ? null : cents(String(req.query.minPrice));
    const maxPrice = req.query.maxPrice === undefined ? null : cents(String(req.query.maxPrice));
    const status = String(req.query.status || "active").trim();
    if (status !== "active") throw Errors.badRequest("公开市集只能查询在售商品；草稿和审核中内容请在“我的”页面查看");
    const where: any = {
      status: "active",
      visibility: "public",
      listingType: "sell",
    };
    const categoryBoundary = resolveMarketCategoryBoundary(scope, category);
    if (!categoryBoundary.valid) {
      throw Errors.badRequest(scope === "market" ? "电子资料请前往靠浦特色学习资料" : "该品类不属于靠浦特色学习资料");
    }
    where.category = categoryBoundary.filter;
    if (q) where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
    ];
    if (listingType && listingType !== "sell") where.id = -1;
    if (ITEM_CONDITIONS.includes(condition as any)) where.condition = condition;
    if (tradeMode && !TRADE_MODES.includes(tradeMode as any)) throw Errors.badRequest("交付方式筛选值无效");
    if (tradeMode && tradeMode !== "any") where.tradeMode = tradeMode;
    if (campus) where.campus = { in: marketCampusStorageAliases(campus), mode: "insensitive" };
    if (minPrice !== null || maxPrice !== null) where.priceCents = {
      ...(minPrice !== null ? { gte: minPrice } : {}),
      ...(maxPrice !== null ? { lte: maxPrice } : {}),
    };
    const sort = String(req.query.sort || "new");
    const contentOrderBy: any = sort === "price_asc" ? { priceCents: "asc" }
      : sort === "price_desc" ? { priceCents: "desc" }
        : sort === "popular" ? [{ favoriteCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }]
          : { createdAt: "desc" };
    const orderBy: any = [{ pinnedUntil: { sort: "desc", nulls: "last" } }, ...(Array.isArray(contentOrderBy) ? contentOrderBy : [contentOrderBy])];
    const [list, total] = await Promise.all([
      prisma.marketItem.findMany({
        where,
        include: {
          ...itemInclude,
          favorites: req.user ? { where: { userId: req.user.userId }, select: { userId: true } } : false,
        },
        orderBy,
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.marketItem.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((item) => serializeItem(item, req.user?.userId)) });
  } catch (error) { next(error); }
}

marketRouter.get("/items", (req, res, next) => listMarketItems(req, res, next, "market"));

marketRouter.get("/items/:id", async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("商品 ID 不合法");
    const item = await prisma.marketItem.findUnique({
      where: { id },
      include: {
        ...itemInclude,
        favorites: req.user ? { where: { userId: req.user.userId }, select: { userId: true } } : false,
      },
    });
    const isOwnerOrStaff = Boolean(item && (req.user?.userId === item.sellerId || ["admin", "mod"].includes(req.user?.role || "")));
    if (!item || (PRIVATE_ITEM_STATUSES.has(item.status) && !isOwnerOrStaff)) {
      throw Errors.notFound("商品不存在");
    }
    if (item.visibility === "targeted" && req.user?.userId !== item.sellerId && !["admin", "mod"].includes(req.user?.role || "")) {
      const wanted = item.sourceWantedPostId
        ? await prisma.wantedPost.findUnique({ where: { id: item.sourceWantedPostId }, select: { authorId: true } })
        : null;
      if (!wanted || wanted.authorId !== req.user?.userId) throw Errors.notFound("商品不存在");
    }
    if (item.status !== "draft") prisma.marketItem.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => null);
    const rating = await prisma.marketReview.aggregate({ where: { targetUserId: item.sellerId }, _avg: { rating: true }, _count: true });
    ok(res, { ...serializeItem(item, req.user?.userId), sellerRating: rating._avg.rating || 0, sellerReviewCount: rating._count });
  } catch (error) { next(error); }
});

marketRouter.get("/items/:id/matches", async (req, res, next) => {
  try {
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("商品 ID 不合法");
    const item = await prisma.marketItem.findUnique({ where: { id }, select: { id: true, status: true, visibility: true } });
    if (!item || item.status !== "active" || item.visibility !== "public") throw Errors.notFound("商品不存在或已结束");
    const matches = await findMatchesForItem(id, 8);
    const rows = await prisma.wantedPost.findMany({
      where: { id: { in: matches.map((match) => match.wantedPost.id) } },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        urgentPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
        _count: { select: { responses: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    ok(res, matches.flatMap((match) => {
      const wantedPost = byId.get(match.wantedPost.id);
      return wantedPost ? [{ wantedPost: serializeWantedPost(wantedPost, req.user?.userId), score: match.score, reasons: match.reasons }] : [];
    }));
  } catch (error) { next(error); }
});

marketRouter.post("/items", authRequired, validate(itemInputSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    await requireVerifiedMarketUser(userId, req.user!.role, "publish");
    await ensureUserCanSpeak(userId);
    const input = req.body as z.infer<typeof itemInputSchema>;
    if (input.listingType !== "sell") throw Errors.badRequest("求购请使用独立求购发布入口");
    if (input.catalog === "learning_materials" || isLearningMaterialCategory(input.category)) {
      throw Errors.badRequest("学习资料必须通过靠浦特色学习资料专属发布接口创建");
    }
    if (!categoryBelongsToCatalog(input.catalog, input.category)) {
      throw Errors.badRequest(input.catalog === "market" ? "电子资料请从靠浦特色学习资料发布" : "学习资料只能发布到靠浦特色学习资料");
    }
    const category = await getMarketCategory(input.category);
    if (category.fulfillmentType !== "physical") throw Errors.badRequest("第一阶段市集只支持实体物品和线下服务撮合，不支持数字商品交易");
    const deliveryType = "physical";
    if (category.imageRequired && input.listingType === "sell" && !input.draft && !input.images.length) {
      throw Errors.badRequest("该品类出售商品时必须上传至少一张图片");
    }
    const priceCents = cents(input.price) ?? 0;
    const originalPriceCents = cents(input.originalPrice);
    const safety = await evaluateMarketContent(prisma, [input.title, input.description, input.brand, input.model, input.flaws, input.location]);
    if (safety.action === "block") throw Errors.badRequest("商品内容包含市集禁售或高风险信息，请修改后再发布");
    const metadata = {
      marketItem: true,
      price: Number(amountCentsToMoney(priceCents)),
      condition: input.condition,
      tradeMode: input.tradeMode,
      deliveryType,
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
    const bypass = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const review = shouldRunAiReview() && !bypass
      ? await reviewTopicContent({ title: input.title, content: input.description, boardName: "校园市集", boardType: "market", metadata })
      : null;
    const hiddenByReview = safety.action === "review" || review?.status === "blocked_ai";
    const item = await prisma.marketItem.create({
      data: {
        sellerId: userId,
        listingType: input.listingType,
        title: input.title,
        description: input.description,
        category: input.category,
        deliveryType,
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
        contactVisibility: input.contactVisibility,
        expiresAt: null,
        visibility: "public",
        status: input.draft ? "draft" : hiddenByReview ? "reviewing" : "active",
        moderationNote: safety.action === "review"
          ? (safety.matches[0]?.note || "市集规则命中人工复核")
          : review?.status === "blocked_ai" ? review.reason : "",
        images: { create: input.images.map((url, sort) => ({ url, sort })) },
      },
      include: itemInclude,
    });
    if (item.status === "active") await notifyMatchesForItem(item.id).catch((error) => console.warn("[market] item matching notification failed", error));
    ok(res, {
      ...serializeItem(item, userId),
      review: review ? { status: review.status, reason: review.reason } : null,
      safetyReview: safety.action === "review" ? { status: "reviewing", reason: "公开内容包含联系方式或需人工复核的信息" } : null,
    });
  } catch (error) { next(error); }
});

marketRouter.patch("/items/:id", authRequired, validate(itemPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.marketItem.findUnique({ where: { id }, include: { images: true } });
    if (!current) throw Errors.notFound("商品不存在");
    const canManage = current.sellerId === req.user!.userId || ["admin", "mod"].includes(req.user!.role);
    if (!canManage) throw Errors.forbidden("无权修改该商品");
    if (!["admin", "mod"].includes(req.user!.role)) await requireVerifiedMarketUser(req.user!.userId, req.user!.role, "publish");
    const input = req.body as z.infer<typeof itemPatchSchema>;
    if (input.status && !["admin", "mod"].includes(req.user!.role) && !["active", "withdrawn", "sold", "draft"].includes(input.status)) {
      throw Errors.forbidden("不能切换到该商品状态");
    }
    const data: any = { ...input };
    delete data.catalog;
    delete data.images;
    delete data.price;
    delete data.originalPrice;
    delete data.draft;
    delete data.digitalDelivery;
    const finalCategory = input.category ?? current.category;
    if (isLearningMaterialCategory(current.category) || isLearningMaterialCategory(finalCategory)) {
      throw Errors.badRequest("学习资料必须通过靠浦特色学习资料专属编辑接口修改");
    }
    const catalogScope = input.catalog ?? (isLearningMaterialCategory(current.category) ? "learning_materials" : "market");
    if (!categoryBelongsToCatalog(catalogScope, finalCategory)) {
      throw Errors.badRequest(catalogScope === "market" ? "电子资料请从靠浦特色学习资料编辑" : "该商品不属于靠浦特色学习资料");
    }
    const category = input.category ? await getMarketCategory(input.category) : await getMarketCategory(current.category, true);
    if (category.fulfillmentType !== "physical") throw Errors.badRequest("数字商品交易已关闭，历史记录只能保留查看");
    const deliveryType = "physical";
    const finalListingType = input.listingType ?? current.listingType;
    if (finalListingType !== "sell") throw Errors.badRequest("历史求购请迁移到独立求购系统后再编辑");
    const finalStatus = input.status || (input.draft === false ? "active" : current.status);
    const finalImageCount = input.images ? input.images.length : current.images.length;
    if (category.imageRequired && finalListingType === "sell" && finalStatus === "active" && finalImageCount === 0) {
      throw Errors.badRequest("该品类出售商品时必须上传至少一张图片");
    }
    const safety = await evaluateMarketContent(prisma, [
      input.title ?? current.title,
      input.description ?? current.description,
      input.brand ?? current.brand,
      input.model ?? current.model,
      input.flaws ?? current.flaws,
      input.location ?? current.location,
    ]);
    if (safety.action === "block") throw Errors.badRequest("商品内容包含市集禁售或高风险信息，请修改后再发布");
    data.deliveryType = deliveryType;
    data.digitalDeliveryEncrypted = null;
    if (input.price !== undefined) data.priceCents = cents(input.price) ?? 0;
    if (input.originalPrice !== undefined) data.originalPriceCents = cents(input.originalPrice);
    if (input.draft !== undefined && !input.status) data.status = input.draft ? "draft" : "active";
    if (safety.action === "review" && finalStatus === "active") data.status = "reviewing";
    data.expiresAt = null;
    if (input.status !== undefined) data.soldAt = input.status === "sold" ? new Date() : null;
    const updated = await prisma.$transaction(async (tx) => {
      if (input.images) {
        await tx.marketImage.deleteMany({ where: { itemId: id } });
        if (input.images.length) await tx.marketImage.createMany({ data: input.images.map((url, sort) => ({ itemId: id, url, sort })) });
      }
      return tx.marketItem.update({ where: { id }, data, include: itemInclude });
    });
    ok(res, serializeItem(updated, req.user!.userId));
  } catch (error) { next(error); }
});

const itemLifecycleSchema = z.object({ action: z.enum(["renew", "withdraw", "mark_sold", "relist"]) });

marketRouter.post("/items/:id/lifecycle", authRequired, validate(itemLifecycleSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.marketItem.findUnique({ where: { id }, include: itemInclude });
    if (!item) throw Errors.notFound("商品不存在");
    if (item.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    if (item.deliveryType !== "physical" || item.visibility !== "public") throw Errors.badRequest("该商品不能执行此操作");
    const action = req.body.action as z.infer<typeof itemLifecycleSchema>["action"];
    let data: any;
    if (action === "renew" || action === "relist") {
      if (!["admin", "mod"].includes(req.user!.role)) await requireVerifiedMarketUser(req.user!.userId, req.user!.role, "publish");
      if (!["active", "expired", "withdrawn", "sold"].includes(item.status)) throw Errors.badRequest("当前状态不能续期或重新上架");
      const safety = await evaluateMarketContent(prisma, [item.title, item.description, item.brand, item.model, item.flaws, item.location]);
      if (safety.action === "block") throw Errors.badRequest("商品内容包含市集禁售或高风险信息，请编辑后再上架");
      data = { status: safety.action === "review" ? "reviewing" : "active", expiresAt: null, renewedAt: new Date(), soldAt: null };
    } else if (action === "withdraw") {
      if (!["active", "negotiating", "expired"].includes(item.status)) throw Errors.badRequest("当前状态不能下架");
      data = { status: "withdrawn" };
    } else {
      if (!["active", "negotiating", "expired", "withdrawn"].includes(item.status)) throw Errors.badRequest("当前状态不能标记为已售");
      data = { status: "sold", soldAt: new Date() };
    }
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.marketItem.update({ where: { id }, data, include: itemInclude });
      if (action === "withdraw" || action === "mark_sold") {
        await tx.tradeIntent.updateMany({ where: { itemId: id, status: "pending" }, data: { status: "expired" } });
      }
      return next;
    });
    ok(res, serializeItem(updated, req.user!.userId));
  } catch (error) { next(error); }
});

marketRouter.delete("/items/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.marketItem.findUnique({ where: { id } });
    if (!item) throw Errors.notFound("商品不存在");
    if (item.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    await prisma.marketItem.update({ where: { id }, data: { status: "withdrawn" } });
    ok(res, { ok: true });
  } catch (error) { next(error); }
});

marketRouter.post("/items/:id/favorite", authRequired, async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const userId = req.user!.userId;
    const item = await prisma.marketItem.findUnique({ where: { id: itemId } });
    if (!item || item.status === "hidden") throw Errors.notFound("商品不存在");
    if (item.sellerId === userId) throw Errors.badRequest("不能收藏自己发布的商品");
    ok(res, await toggleMarketItemFavorite(itemId, userId));
  } catch (error) { next(error); }
});

const tradeIntentSchema = z.object({
  price: z.union([z.string(), z.number()]),
  message: z.string().trim().max(500).optional().default(""),
  availableTime: z.string().trim().min(1).max(300),
});

marketRouter.post("/items/:id/intents", authRequired, validate(tradeIntentSchema), async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const itemId = Number(req.params.id);
    const buyerId = req.user!.userId;
    await requireVerifiedMarketUser(buyerId, req.user!.role);
    await ensureUserCanSpeak(buyerId);
    const item = await prisma.marketItem.findUnique({ where: { id: itemId }, include: { seller: { select: MARKET_PUBLIC_USER_SELECT } } });
    if (!item || item.status !== "active" || item.visibility !== "public" || item.listingType !== "sell" || item.deliveryType !== "physical") {
      throw Errors.badRequest("商品当前不可提交购买意向");
    }
    if (item.sellerId === buyerId) throw Errors.badRequest("不能购买自己发布的商品");
    const proposedPriceCents = cents(req.body.price, false)!;
    if (!item.negotiable && proposedPriceCents !== item.priceCents) throw Errors.badRequest("该商品不接受议价");
    const duplicate = await prisma.tradeIntent.findFirst({ where: { itemId, buyerId, status: "pending" } });
    if (duplicate) throw Errors.conflict("你已经提交过待处理的购买意向");
    const intent = await prisma.$transaction(async (tx) => {
      const intent = await tx.tradeIntent.create({
        data: {
          itemId,
          buyerId,
          proposedPriceCents,
          message: req.body.message,
          availableTime: req.body.availableTime,
          expiresAt: nextIntentExpiry(),
        },
      });
      await tx.marketItem.update({ where: { id: itemId }, data: { offerCount: { increment: 1 } } });
      return intent;
    });
    await notify(item.sellerId, "收到新的购买意向", `有人想以 ¥${amountCentsToMoney(proposedPriceCents)} 预订「${item.title}」`, "/market/mine?tab=intents", { type: "trade-intent", itemId, tradeIntentId: intent.id });
    ok(res, { ...serializeTradeIntent(intent), conversationId: null });
  } catch (error) { next(error); }
});

const tradeIntentActionSchema = z.object({ action: z.enum(["accept", "reject", "cancel"]) });

marketRouter.patch("/trade-intents/:id", authRequired, validate(tradeIntentActionSchema), async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = Number(req.params.id);
    const intent = await prisma.tradeIntent.findUnique({ where: { id }, include: { item: true } });
    if (!intent) throw Errors.notFound("购买意向不存在");
    if (intent.status !== "pending" || intent.expiresAt <= new Date()) throw Errors.badRequest("该购买意向已经处理或过期");
    const action = req.body.action as z.infer<typeof tradeIntentActionSchema>["action"];
    if (action === "cancel") {
      if (intent.buyerId !== req.user!.userId) throw Errors.forbidden();
      const updated = await prisma.tradeIntent.update({ where: { id }, data: { status: "cancelled" } });
      return ok(res, serializeTradeIntent(updated));
    }
    if (intent.item.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    if (action === "reject") {
      const updated = await prisma.tradeIntent.update({ where: { id }, data: { status: "rejected" } });
      await notify(intent.buyerId, "购买意向未被接受", `卖家暂未接受你对「${intent.item.title}」的购买意向`, `/market/item/${intent.itemId}`, { type: "trade-intent-rejected", itemId: intent.itemId, tradeIntentId: id });
      return ok(res, serializeTradeIntent(updated));
    }
    if (intent.item.status !== "active" || intent.item.visibility !== "public") throw Errors.badRequest("商品当前不可预订");
    const orderAmounts = directTradeOrderAmounts(intent.proposedPriceCents);
    const reservation = await prisma.$transaction(async (tx) => {
      const reserved = await tx.marketItem.updateMany({ where: { id: intent.itemId, status: "active", visibility: "public" }, data: { status: "reserved" } });
      if (reserved.count !== 1) throw Errors.conflict("商品已被其他意向预订");
      await tx.tradeIntent.update({ where: { id }, data: { status: "accepted", acceptedAt: new Date() } });
      await tx.tradeIntent.updateMany({ where: { itemId: intent.itemId, id: { not: id }, status: "pending" }, data: { status: "rejected" } });
      const created = await tx.marketOrder.create({
        data: {
          itemId: intent.itemId,
          tradeIntentId: id,
          buyerId: intent.buyerId,
          sellerId: intent.item.sellerId,
          outTradeNo: nextMarketTradeNo(intent.buyerId),
          amountCents: intent.proposedPriceCents,
          platformFeeCents: orderAmounts.platformFeeCents,
          sellerAmountCents: orderAmounts.sellerAmountCents,
          deliveryType: "physical",
          status: "reserved",
          expiresAt: nextReservationExpiry(),
        },
      });
      await tx.marketConversation.upsert({
        where: { itemId_buyerId_sellerId: { itemId: intent.itemId, buyerId: intent.buyerId, sellerId: intent.item.sellerId } },
        create: { itemId: intent.itemId, orderId: created.id, buyerId: intent.buyerId, sellerId: intent.item.sellerId },
        update: { orderId: created.id },
      });
      return created;
    });
    await notify(intent.buyerId, "卖家已接受购买意向", `「${intent.item.title}」已为你预订，请在 72 小时内约定校内见面时间和地点。`, "/market/mine?tab=reservations", { type: "trade-intent-accepted", itemId: intent.itemId, reservationId: reservation.id, notice: DIRECT_TRADE_NOTICE });
    ok(res, serializeOrder(reservation, req.user!.userId, req.user!.role));
  } catch (error) { next(error); }
});

const offerSchema = z.object({
  price: z.union([z.string(), z.number()]),
  message: z.string().trim().max(500).optional().default(""),
});

marketRouter.post("/items/:id/offers", authRequired, validate(offerSchema), async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const buyerId = req.user!.userId;
    await requireVerifiedMarketUser(buyerId, req.user!.role);
    await ensureUserCanSpeak(buyerId);
    const item = await prisma.marketItem.findUnique({ where: { id: itemId }, include: { seller: { select: MARKET_PUBLIC_USER_SELECT } } });
    if (!item || item.status !== "active") throw Errors.badRequest("商品当前不可提交购买意向");
    if (isLearningMaterialCategory(item.category)) throw Errors.badRequest("学习资料不接受议价或购买意向，请在资料专区直接购买");
    if (item.listingType !== "sell") throw Errors.badRequest("求购信息请先通过站内沟通联系发布者");
    if (item.sellerId === buyerId) throw Errors.badRequest("不能购买自己发布的商品");
    const priceCents = cents(req.body.price, false)!;
    if (!item.negotiable && priceCents !== item.priceCents) throw Errors.badRequest("该商品不接受议价");
    const duplicate = await prisma.marketOffer.findFirst({ where: { itemId, buyerId, status: "pending" } });
    if (duplicate) throw Errors.conflict("你已经提交过待处理的购买意向");
    const result = await prisma.$transaction(async (tx) => {
      const offer = await tx.marketOffer.create({ data: { itemId, buyerId, priceCents, message: req.body.message } });
      const conversation = await tx.marketConversation.upsert({
        where: { itemId_buyerId_sellerId: { itemId, buyerId, sellerId: item.sellerId } },
        create: { itemId, buyerId, sellerId: item.sellerId, lastMessageAt: req.body.message ? new Date() : null },
        update: {},
      });
      if (req.body.message) {
        await tx.marketMessage.create({ data: { conversationId: conversation.id, senderId: buyerId, content: req.body.message } });
      }
      await tx.marketItem.update({ where: { id: itemId }, data: { offerCount: { increment: 1 } } });
      return { offer, conversation };
    });
    await notify(item.sellerId, "收到新的购买意向", `有人想以 ¥${amountCentsToMoney(priceCents)} 购买「${item.title}」`, `/market/mine?tab=selling`, { type: "market-offer", itemId, offerId: result.offer.id });
    ok(res, { ...result.offer, price: amountCentsToMoney(result.offer.priceCents), conversationId: result.conversation.id });
  } catch (error) { next(error); }
});

const offerActionSchema = z.object({ action: z.enum(["accept", "reject", "cancel"]) });

marketRouter.patch("/offers/:id", authRequired, validate(offerActionSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const offer = await prisma.marketOffer.findUnique({ where: { id }, include: { item: true } });
    if (!offer) throw Errors.notFound("购买意向不存在");
    if (offer.status !== "pending") throw Errors.badRequest("该购买意向已经处理");
    const action = req.body.action as "accept" | "reject" | "cancel";
    if (action === "cancel") {
      if (offer.buyerId !== req.user!.userId) throw Errors.forbidden();
      const updated = await prisma.marketOffer.update({ where: { id }, data: { status: "cancelled" } });
      return ok(res, updated);
    }
    if (offer.item.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden();
    if (action === "reject") {
      const updated = await prisma.marketOffer.update({ where: { id }, data: { status: "rejected" } });
      await notify(offer.buyerId, "购买意向未被接受", `卖家暂未接受你对「${offer.item.title}」的购买意向`, `/market/item/${offer.itemId}`, { type: "market-offer-rejected", itemId: offer.itemId, offerId: id });
      return ok(res, updated);
    }
    if (offer.item.status !== "active") throw Errors.badRequest("商品当前不可预订");
    if (offer.item.deliveryType === "digital") throw Errors.badRequest("数字资料交易已关闭，仅保留免费原创内容改造");
    const orderAmounts = directTradeOrderAmounts(offer.priceCents);
    const order = await prisma.$transaction(async (tx) => {
      const reservation = await tx.marketItem.updateMany({
        where: { id: offer.itemId, status: "active" },
        data: { status: "reserved" },
      });
      if (reservation.count !== 1) throw Errors.conflict("商品刚刚已被其他购买意向预订，请刷新后重试");
      await tx.marketOffer.update({ where: { id }, data: { status: "accepted" } });
      await tx.marketOffer.updateMany({ where: { itemId: offer.itemId, id: { not: id }, status: "pending" }, data: { status: "rejected" } });
      const created = await tx.marketOrder.create({
        data: {
          itemId: offer.itemId,
          offerId: id,
          buyerId: offer.buyerId,
          sellerId: offer.item.sellerId,
          outTradeNo: nextMarketTradeNo(offer.buyerId),
          amountCents: offer.priceCents,
          platformFeeCents: orderAmounts.platformFeeCents,
          sellerAmountCents: orderAmounts.sellerAmountCents,
          deliveryType: offer.item.deliveryType || "physical",
          digitalDeliveryEncrypted: null,
          status: "delivering",
          expiresAt: null,
        },
      });
      await tx.marketConversation.upsert({
        where: { itemId_buyerId_sellerId: { itemId: offer.itemId, buyerId: offer.buyerId, sellerId: offer.item.sellerId } },
        create: { itemId: offer.itemId, orderId: created.id, buyerId: offer.buyerId, sellerId: offer.item.sellerId },
        update: { orderId: created.id },
      });
      return created;
    });
    await notify(offer.buyerId, "卖家已接受购买意向", `「${offer.item.title}」已预订。请在站内约定时间地点，当面验货后直接向卖家付款。`, `/market/mine?tab=orders`, { type: "market-offer-accepted", itemId: offer.itemId, orderId: order.id, notice: DIRECT_TRADE_NOTICE });
    ok(res, serializeOrder(order, req.user!.userId, req.user!.role));
  } catch (error) { next(error); }
});

const paySchema = z.object({ payType: z.enum(PAY_TYPES) });

marketRouter.post("/orders/:id/pay", authRequired, validate(paySchema), async (req, res, next) => {
  try {
    if (!STUDENT_MARKET_PAYMENT_ENABLED) throw Errors.forbidden(MARKET_PAYMENT_DISABLED_MESSAGE);
    await closeExpiredMarketOrders();
    const id = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({ where: { id }, include: { item: true } });
    if (!order || order.buyerId !== req.user!.userId) throw Errors.notFound("订单不存在");
    if (order.status !== "pending_payment") throw Errors.badRequest("该订单当前不可支付");
    if (order.expiresAt && order.expiresAt <= new Date()) throw Errors.badRequest("订单已超时关闭");
    const enabled = await getEnabledEpayTypes();
    if (!enabled.includes(req.body.payType as EpayPayType)) throw Errors.badRequest("该支付方式暂不可用");
    const origin = resolvePaymentOrigin(requestOrigin(req));
    if (!origin) throw Errors.badRequest("请先在后台配置站点域名");
    const updated = await prisma.marketOrder.update({ where: { id }, data: { payType: req.body.payType } });
    const epay = await buildEpaySubmitPayload({
      outTradeNo: updated.outTradeNo,
      name: `靠浦校园市集 - ${order.item.title}`.slice(0, 120),
      money: amountCentsToMoney(updated.amountCents),
      type: req.body.payType,
      notifyUrl: `${origin}/api/market/payments/notify`,
      returnUrl: `${origin}/api/market/payments/return`,
      clientIp: req.ip,
      device: "pc",
      param: `market:${updated.id}`,
    });
    ok(res, { order: serializeOrder(updated, req.user!.userId, req.user!.role), epay });
  } catch (error: any) {
    if (/易支付|支付方式|商户|网关|回调|订单号|商品名称/.test(String(error?.message || ""))) return next(Errors.badRequest(error.message));
    next(error);
  }
});

function normalizePaymentParams(input: Record<string, unknown>) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) params[key] = String(value[0] ?? "");
    else if (value !== undefined && value !== null) params[key] = String(value);
  }
  return params;
}

marketRouter.all("/payments/notify", async (req, res, next) => {
  if (!STUDENT_MARKET_PAYMENT_ENABLED) return res.type("text/plain").status(410).send("disabled");
  let logId: number | null = null;
  try {
    const params = normalizePaymentParams({ ...req.query, ...req.body });
    const outTradeNo = params.out_trade_no || "";
    const existing = outTradeNo ? await prisma.marketOrder.findUnique({ where: { outTradeNo } }) : null;
    const key = await getEpayMerchantKey();
    const signOk = Boolean(key && verifyEpayParams(params, key));
    const log = await prisma.marketPaymentLog.create({
      data: { orderId: existing?.id || null, outTradeNo: outTradeNo || null, rawPayload: JSON.stringify(params), signOk, result: signOk ? "received" : "bad-sign" },
    });
    logId = log.id;
    if (!signOk) return res.type("text/plain").status(400).send("fail");
    if (params.trade_status !== "TRADE_SUCCESS") {
      await prisma.marketPaymentLog.update({ where: { id: log.id }, data: { handled: true, result: "ignored-status" } });
      return res.type("text/plain").send("success");
    }
    const paidCents = moneyToAmountCents(params.money || "0");
    let paidOrder: any = existing;
    let newlyPaid = false;
    await prisma.$transaction(async (tx) => {
      const order = await tx.marketOrder.findUnique({ where: { outTradeNo } });
      if (!order) throw new Error("订单不存在");
      if (["paid", "delivering", "completed", "refund_pending", "refunded"].includes(order.status)) {
        paidOrder = order;
        return;
      }
      if (order.status !== "pending_payment") throw new Error("订单状态不可支付");
      if (order.amountCents !== paidCents) throw new Error("支付金额与订单不一致");
      const isDigital = order.deliveryType === "digital";
      paidOrder = await tx.marketOrder.update({
        where: { id: order.id },
        data: {
          status: isDigital ? "delivering" : "paid",
          tradeNo: params.trade_no || null,
          paidAt: new Date(),
          digitalDeliveredAt: isDigital ? new Date() : null,
          sellerConfirmedAt: isDigital ? new Date() : null,
        },
      });
      if (!isDigital) await tx.marketItem.update({ where: { id: order.itemId }, data: { status: "reserved" } });
      if (isDigital) {
        const profile = await tx.learningMaterialProfile.findUnique({ where: { itemId: order.itemId } });
        if (profile?.activeVersionId) {
          await tx.learningMaterialAccess.upsert({
            where: { orderId: order.id },
            create: { orderId: order.id, versionId: profile.activeVersionId, userId: order.buyerId },
            update: { versionId: profile.activeVersionId, userId: order.buyerId, revokedAt: null },
          });
        }
      }
      newlyPaid = true;
    });
    if (newlyPaid && paidOrder) {
      const item = await prisma.marketItem.findUnique({ where: { id: paidOrder.itemId } });
      await Promise.all([
        notify(paidOrder.buyerId, "商城订单支付成功", paidOrder.deliveryType === "digital" ? `「${item?.title || "商品"}」已进入我的资料库` : `「${item?.title || "商品"}」已支付，请与卖家确认交付安排`, paidOrder.deliveryType === "digital" ? `/market/learning-materials/library` : `/market/mine?tab=orders`, { type: "market-paid", orderId: paidOrder.id }),
        notify(paidOrder.sellerId, "买家已完成支付", paidOrder.deliveryType === "digital" ? `「${item?.title || "商品"}」已自动完成线上发货，等待买家确认` : `「${item?.title || "商品"}」已收到平台支付，请安排交付`, `/market/seller?tab=orders`, { type: "market-paid-seller", orderId: paidOrder.id }),
      ]);
    }
    if (logId) await prisma.marketPaymentLog.update({ where: { id: logId }, data: { handled: true, result: "success", orderId: paidOrder?.id || existing?.id || null } });
    res.type("text/plain").send("success");
  } catch (error: any) {
    if (logId) await prisma.marketPaymentLog.update({ where: { id: logId }, data: { handled: false, result: String(error?.message || "error") } }).catch(() => null);
    if (/订单|金额|支付/.test(String(error?.message || ""))) return res.type("text/plain").status(400).send("fail");
    next(error);
  }
});

marketRouter.get("/payments/return", async (req, res) => {
  if (!STUDENT_MARKET_PAYMENT_ENABLED) return res.redirect(302, "/market/mine?tab=orders&payment=disabled");
  const origin = resolvePaymentOrigin(requestOrigin(req));
  const status = String(req.query.trade_status || "") === "TRADE_SUCCESS" ? "success" : "pending";
  const outTradeNo = encodeURIComponent(String(req.query.out_trade_no || ""));
  const target = `${origin || ""}/market/mine?tab=orders&payment=${status}${outTradeNo ? `&outTradeNo=${outTradeNo}` : ""}`;
  res.redirect(302, target || "/market/mine?tab=orders");
});

const orderActionSchema = z.object({
  action: z.enum(["set_meetup", "buyer_confirm", "seller_confirm", "cancel", "report_no_show", "request_refund", "dispute"]),
  meetupTime: z.string().datetime().optional(),
  meetupLocation: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
});

marketRouter.patch("/orders/:id", authRequired, validate(orderActionSchema), async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({ where: { id }, include: { item: true, refunds: true, wantedPost: true } });
    if (!order || (order.buyerId !== req.user!.userId && order.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role))) {
      throw Errors.notFound("交易预约不存在");
    }
    const action = req.body.action as z.infer<typeof orderActionSchema>["action"];
    const isBuyer = order.buyerId === req.user!.userId;
    const isSeller = order.sellerId === req.user!.userId;
    const restoreItemStatus = () => order.item.visibility === "targeted"
      ? "targeted"
      : order.item.expiresAt && order.item.expiresAt <= new Date() ? "expired" : "active";

    if (action === "set_meetup") {
      if (order.deliveryType === "digital") throw Errors.badRequest("电子资料历史订单无需设置面交安排");
      if (!["paid", "delivering", "reserved"].includes(order.status)) throw Errors.badRequest("当前预约不能修改面交安排");
      const meetupTime = req.body.meetupTime ? new Date(req.body.meetupTime) : order.meetupTime;
      const meetupLocation = req.body.meetupLocation ?? order.meetupLocation;
      if (!meetupTime || !meetupLocation.trim()) throw Errors.badRequest("请同时填写面交时间和校内地点");
      if (req.body.meetupTime) {
        const earliest = Date.now() + 15 * 60_000;
        const latest = Date.now() + 30 * 24 * 60 * 60_000;
        if (meetupTime.getTime() < earliest || meetupTime.getTime() > latest) throw Errors.badRequest("面交时间须在 15 分钟后至 30 天内");
      }
      const updated = await prisma.marketOrder.update({
        where: { id },
        data: {
          status: order.status === "reserved" ? "reserved" : "delivering",
          meetupTime,
          meetupLocation,
          meetupReminderSentAt: null,
          note: req.body.note ?? order.note,
          expiresAt: order.status === "reserved" ? nextReservationExpiry(new Date(), meetupTime) : order.expiresAt,
        },
      });
      await notify(isBuyer ? order.sellerId : order.buyerId, "校内面交安排已更新", `「${order.item.title}」的见面时间或地点已更新`, "/market/mine?tab=reservations", { type: "market-meetup", orderId: id });
      return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
    }

    if (action === "buyer_confirm" || action === "seller_confirm") {
      if (action === "buyer_confirm" && !isBuyer) throw Errors.forbidden();
      if (action === "seller_confirm" && !isSeller) throw Errors.forbidden();
      if (!["paid", "delivering", "reserved"].includes(order.status)) throw Errors.badRequest("当前预约不能确认完成");
      const data = action === "buyer_confirm" ? { buyerConfirmedAt: new Date() } : { sellerConfirmedAt: new Date() };
      let updated = await prisma.marketOrder.update({ where: { id }, data });
      if (updated.buyerConfirmedAt && updated.sellerConfirmedAt) {
        updated = await prisma.$transaction(async (tx) => {
          const completed = await tx.marketOrder.update({ where: { id }, data: { status: "completed", completedAt: new Date(), expiresAt: null } });
          if (order.deliveryType !== "digital") await tx.marketItem.update({ where: { id: order.itemId }, data: { status: "sold", soldAt: new Date() } });
          if (order.wantedPostId) await tx.wantedPost.update({ where: { id: order.wantedPostId }, data: { status: "completed" } });
          if (order.paidAt) {
            await tx.marketSettlement.upsert({
              where: { orderId: id },
              create: { orderId: id, sellerId: order.sellerId, amountCents: order.sellerAmountCents, status: "available", availableAt: new Date() },
              update: { status: "available", availableAt: new Date() },
            });
          }
          return completed;
        });
        await Promise.all([
          notify(order.buyerId, "交易已完成", `「${order.item.title}」已由双方确认，可评价卖家`, "/market/mine?tab=history", { type: "market-completed", orderId: id }),
          notify(order.sellerId, "交易已完成", `「${order.item.title}」已由双方确认，可评价买家`, "/market/mine?tab=history", { type: "market-completed-seller", orderId: id }),
        ]);
      }
      return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
    }

    if (action === "cancel") {
      if (["reserved", "delivering"].includes(order.status) && !order.paidAt) {
        const reason = String(req.body.reason || "").trim();
        if (!reason) throw Errors.badRequest("请选择或填写取消原因");
        const updated = await prisma.$transaction(async (tx) => {
          const cancelled = await tx.marketOrder.update({ where: { id }, data: { status: "cancelled", closedAt: new Date(), cancelReason: reason, cancelledById: req.user!.userId, expiresAt: null } });
          if (order.offerId) await tx.marketOffer.update({ where: { id: order.offerId }, data: { status: "cancelled" } });
          if (order.tradeIntentId) await tx.tradeIntent.update({ where: { id: order.tradeIntentId }, data: { status: "cancelled" } });
          if (order.wantedResponseId) await tx.wantedResponse.update({ where: { id: order.wantedResponseId }, data: { status: "cancelled" } });
          if (order.wantedPostId) await tx.wantedPost.updateMany({ where: { id: order.wantedPostId, status: "matched" }, data: { status: "responded" } });
          await tx.marketItem.update({ where: { id: order.itemId }, data: { status: restoreItemStatus() } });
          return cancelled;
        });
        await notify(isBuyer ? order.sellerId : order.buyerId, "交易预约已取消", `「${order.item.title}」的预约已取消：${reason}`, "/market/mine?tab=reservations", { type: "market-reservation-cancelled", orderId: id });
        return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
      }
      if (order.status === "pending_payment" && order.offerId) {
        const updated = await prisma.$transaction(async (tx) => {
          const cancelled = await tx.marketOrder.update({ where: { id }, data: { status: "cancelled", closedAt: new Date(), note: req.body.reason || order.note } });
          await tx.marketOffer.update({ where: { id: order.offerId! }, data: { status: "cancelled" } });
          await tx.marketItem.update({ where: { id: order.itemId }, data: { status: "active" } });
          return cancelled;
        });
        return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
      }
      if (["paid", "delivering"].includes(order.status) && order.paidAt) {
        const refund = await prisma.$transaction(async (tx) => {
          const created = await tx.marketRefund.create({ data: { orderId: id, requestedById: req.user!.userId, amountCents: order.amountCents, reason: req.body.reason || "历史交易取消" } });
          await tx.marketOrder.update({ where: { id }, data: { status: "refund_pending" } });
          return created;
        });
        return ok(res, { refund, order: serializeOrder({ ...order, status: "refund_pending" }, req.user!.userId, req.user!.role) });
      }
      throw Errors.badRequest("当前交易不能取消");
    }

    if (action === "report_no_show") {
      if (order.status !== "reserved" || order.paidAt) throw Errors.badRequest("当前预约不能登记爽约");
      const reason = String(req.body.reason || "").trim();
      if (!reason) throw Errors.badRequest("请说明爽约情况");
      const noShowParty = isBuyer ? "seller" : "buyer";
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.marketOrder.update({ where: { id }, data: { status: "no_show", closedAt: new Date(), noShowParty, cancelReason: reason, cancelledById: req.user!.userId, expiresAt: null } });
        if (order.tradeIntentId) await tx.tradeIntent.updateMany({ where: { id: order.tradeIntentId }, data: { status: "expired" } });
        if (order.wantedResponseId) await tx.wantedResponse.updateMany({ where: { id: order.wantedResponseId }, data: { status: "expired" } });
        if (order.wantedPostId) await tx.wantedPost.updateMany({ where: { id: order.wantedPostId, status: "matched" }, data: { status: "responded" } });
        await tx.marketItem.updateMany({ where: { id: order.itemId, status: "reserved" }, data: { status: restoreItemStatus() } });
        return row;
      });
      await notify(isBuyer ? order.sellerId : order.buyerId, "交易预约被登记爽约", `「${order.item.title}」的另一方提交了爽约记录；如有异议请发起申诉。`, "/market/mine?tab=reservations", { type: "market-no-show", orderId: id });
      return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
    }

    if (action === "request_refund") {
      if (!order.paidAt) throw Errors.badRequest("靠浦未代收该商品款，请双方直接协商；如有违规请发起举报");
      if (!isBuyer) throw Errors.forbidden();
      if (!["paid", "delivering", "disputed"].includes(order.status)) throw Errors.badRequest("当前历史订单不能申请退款");
      if (order.refunds.some((refund) => ["pending", "approved"].includes(refund.status))) throw Errors.conflict("已有退款申请正在处理");
      const refund = await prisma.$transaction(async (tx) => {
        const created = await tx.marketRefund.create({ data: { orderId: id, requestedById: req.user!.userId, amountCents: order.amountCents, reason: req.body.reason || "买家申请退款" } });
        await tx.marketOrder.update({ where: { id }, data: { status: "refund_pending" } });
        return created;
      });
      return ok(res, refund);
    }

    if (action === "dispute") {
      if (!["paid", "delivering", "reserved", "refund_pending", "no_show"].includes(order.status)) throw Errors.badRequest("当前交易不能发起纠纷");
      const updated = await prisma.marketOrder.update({ where: { id }, data: { status: "disputed", note: req.body.reason || order.note } });
      const admins = await prisma.user.findMany({ where: { role: { in: ["admin", "mod"] } }, select: { id: true } });
      if (admins.length) await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, category: "market", level: "strong", title: "市集交易纠纷", content: `交易记录 ${order.outTradeNo} 已发起纠纷`, link: "/admin?tab=market", source: "靠浦校园市集", payload: JSON.stringify({ type: "market-dispute", orderId: id }) })) });
      return ok(res, serializeOrder(updated, req.user!.userId, req.user!.role));
    }
    throw Errors.badRequest();
  } catch (error) { next(error); }
});

const conversationCreateSchema = z.object({ message: z.string().trim().max(1000).optional().default("") });

marketRouter.post("/items/:id/conversations", authRequired, validate(conversationCreateSchema), async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const buyerId = req.user!.userId;
    const item = await prisma.marketItem.findUnique({ where: { id: itemId } });
    if (!item || ["hidden", "withdrawn"].includes(item.status)) throw Errors.notFound("商品不存在");
    if (isLearningMaterialCategory(item.category)) throw Errors.badRequest("学习资料领取前不开放私聊；如需交流请在广场主动发起关联讨论，领取后请使用订单售后");
    if (item.sellerId === buyerId) throw Errors.badRequest("不能与自己发起会话");
    const order = await prisma.marketOrder.findFirst({
      where: { itemId, buyerId, sellerId: item.sellerId, status: { in: PRIVATE_TRADE_STATUSES } },
      orderBy: { createdAt: "desc" },
    });
    if (!order) throw Errors.forbidden("卖家接受购买意向后才开放交易会话");
    const conversation = await prisma.marketConversation.upsert({
      where: { itemId_buyerId_sellerId: { itemId, buyerId, sellerId: item.sellerId } },
      create: { itemId, orderId: order.id, buyerId, sellerId: item.sellerId, lastMessageAt: req.body.message ? new Date() : null },
      update: { orderId: order.id },
    });
    if (req.body.message) {
      await prisma.$transaction([
        prisma.marketMessage.create({ data: { conversationId: conversation.id, senderId: buyerId, content: req.body.message } }),
        prisma.marketConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } }),
      ]);
      await notify(item.sellerId, "收到商品咨询", `有人咨询「${item.title}」`, `/market/messages?conversation=${conversation.id}`, { type: "market-message", itemId, conversationId: conversation.id });
    }
    ok(res, conversation);
  } catch (error) { next(error); }
});

marketRouter.get("/conversations", authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const list = await prisma.marketConversation.findMany({
      where: { orderId: { not: null }, order: { status: { in: PRIVATE_TRADE_STATUSES } }, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: {
        item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
        buyer: { select: MARKET_PUBLIC_USER_SELECT },
        seller: { select: MARKET_PUBLIC_USER_SELECT },
        order: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    });
    ok(res, list.map((conversation) => ({
      ...conversation,
      item: { ...conversation.item, price: amountCentsToMoney(conversation.item.priceCents) },
      order: conversation.order ? serializeOrder(conversation.order, userId, req.user!.role) : null,
      counterpart: conversation.buyerId === userId ? conversation.seller : conversation.buyer,
      lastMessage: conversation.messages[0] || null,
    })));
  } catch (error) { next(error); }
});

marketRouter.get("/conversations/:id/messages", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const conversation = await prisma.marketConversation.findUnique({ where: { id }, include: { order: { select: { status: true } } } });
    if (!conversation || !conversation.order || !PRIVATE_TRADE_STATUSES.includes(conversation.order.status) || (conversation.buyerId !== req.user!.userId && conversation.sellerId !== req.user!.userId)) throw Errors.notFound("会话不存在");
    const messages = await prisma.marketMessage.findMany({ where: { conversationId: id }, include: { sender: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "asc" }, take: 300 });
    await prisma.marketMessage.updateMany({ where: { conversationId: id, senderId: { not: req.user!.userId }, readAt: null }, data: { readAt: new Date() } });
    ok(res, messages);
  } catch (error) { next(error); }
});

const messageSchema = z.object({ content: z.string().trim().min(1).max(2000) });

marketRouter.post("/conversations/:id/messages", authRequired, validate(messageSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await ensureUserCanSpeak(req.user!.userId);
    const conversation = await prisma.marketConversation.findUnique({ where: { id }, include: { item: true, order: { select: { status: true } } } });
    if (!conversation || !conversation.order || !PRIVATE_TRADE_STATUSES.includes(conversation.order.status) || (conversation.buyerId !== req.user!.userId && conversation.sellerId !== req.user!.userId)) throw Errors.notFound("会话不存在");
    if (isLearningMaterialCategory(conversation.item.category)) throw Errors.badRequest("学习资料普通私聊已关闭，请使用订单售后服务单");
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.marketMessage.create({ data: { conversationId: id, senderId: req.user!.userId, content: req.body.content } });
      await tx.marketConversation.update({ where: { id }, data: { lastMessageAt: created.createdAt } });
      return created;
    });
    const recipientId = conversation.buyerId === req.user!.userId ? conversation.sellerId : conversation.buyerId;
    await notify(recipientId, "收到交易消息", `「${conversation.item.title}」有一条新消息`, `/market/messages?conversation=${id}`, { type: "market-message", conversationId: id, itemId: conversation.itemId });
    ok(res, message);
  } catch (error) { next(error); }
});

marketRouter.get("/mine", authRequired, async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const userId = req.user!.userId;
    const [selling, favoriteRows, offers, sellerOffers, orders, conversations, participantConversations, payout, wantedPosts, wantedResponses, tradeIntents, sellerTradeIntents] = await Promise.all([
      prisma.marketItem.findMany({ where: { sellerId: userId }, include: itemInclude, orderBy: { updatedAt: "desc" }, take: 100 }),
      prisma.marketFavorite.findMany({ where: { userId }, include: { item: { include: itemInclude } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketOffer.findMany({ where: { buyerId: userId }, include: { item: { include: { images: { orderBy: { sort: "asc" }, take: 1 }, seller: { select: MARKET_PUBLIC_USER_SELECT } } }, order: true }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketOffer.findMany({
        where: { item: { sellerId: userId }, status: "pending" },
        include: {
          item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
          buyer: { select: MARKET_PUBLIC_USER_SELECT },
          order: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.marketOrder.findMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
        include: {
          item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
          buyer: { select: MARKET_PUBLIC_USER_SELECT },
          seller: { select: MARKET_PUBLIC_USER_SELECT },
          offer: true,
          settlement: true,
          refunds: { orderBy: { createdAt: "desc" } },
          reviews: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.marketConversation.count({ where: { orderId: { not: null }, order: { status: { in: PRIVATE_TRADE_STATUSES } }, OR: [{ buyerId: userId }, { sellerId: userId }] } }),
      prisma.marketConversation.findMany({
        where: { orderId: { not: null }, order: { status: { in: PRIVATE_TRADE_STATUSES } }, OR: [{ buyerId: userId }, { sellerId: userId }] },
        select: { id: true, itemId: true, buyerId: true, sellerId: true },
      }),
      prisma.marketPayoutProfile.findUnique({ where: { userId }, select: { method: true, accountMasked: true, realNameMasked: true, verified: true, updatedAt: true } }),
      prisma.wantedPost.findMany({
        where: { authorId: userId },
        include: { author: { select: MARKET_PUBLIC_USER_SELECT }, _count: { select: { responses: true } } },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.wantedResponse.findMany({
        where: { sellerId: userId },
        include: { seller: { select: MARKET_PUBLIC_USER_SELECT }, wantedPost: true, item: { include: itemInclude }, reservation: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.tradeIntent.findMany({
        where: { buyerId: userId },
        include: { item: { include: itemInclude }, reservation: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.tradeIntent.findMany({
        where: { item: { sellerId: userId }, status: "pending" },
        include: { buyer: { select: MARKET_PUBLIC_USER_SELECT }, item: { include: itemInclude }, reservation: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const conversationByItemAndBuyer = new Map(
      participantConversations.map((conversation) => [`${conversation.itemId}:${conversation.buyerId}`, conversation.id]),
    );
    ok(res, {
      selling: selling.map((item) => serializeItem(item, userId)),
      favorites: favoriteRows.map((row: any) => serializeItem(row.item, userId)),
      offers: offers.map((offer) => ({ ...offer, price: amountCentsToMoney(offer.priceCents), order: offer.order ? serializeOrder(offer.order, userId, req.user!.role) : null })),
      sellerOffers: sellerOffers.map((offer) => ({
        ...offer,
        price: amountCentsToMoney(offer.priceCents),
        order: offer.order ? serializeOrder(offer.order, userId, req.user!.role) : null,
        conversationId: conversationByItemAndBuyer.get(`${offer.itemId}:${offer.buyerId}`) || null,
      })),
      orders: orders.map((order) => ({
        ...serializeOrder(order, userId, req.user!.role),
        conversationId: conversationByItemAndBuyer.get(`${order.itemId}:${order.buyerId}`) || null,
      })),
      conversationCount: conversations,
      payoutProfile: payout,
      wantedPosts: wantedPosts.map((post) => serializeWantedPost(post, userId)),
      wantedResponses: wantedResponses.map(serializeWantedResponse),
      tradeIntents: tradeIntents.map((intent) => ({
        ...serializeTradeIntent(intent),
        item: serializeItem(intent.item, userId),
        reservation: intent.reservation ? serializeOrder(intent.reservation, userId, req.user!.role) : null,
        conversationId: conversationByItemAndBuyer.get(`${intent.itemId}:${intent.buyerId}`) || null,
      })),
      sellerTradeIntents: sellerTradeIntents.map((intent) => ({
        ...serializeTradeIntent(intent),
        item: serializeItem(intent.item, userId),
        conversationId: conversationByItemAndBuyer.get(`${intent.itemId}:${intent.buyerId}`) || null,
      })),
    });
  } catch (error) { next(error); }
});

marketRouter.get("/seller/dashboard", authRequired, async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const sellerId = req.user!.userId;
    await requireVerifiedMarketUser(sellerId, req.user!.role);
    const [items, orders, settlements, payoutProfile, config] = await Promise.all([
      prisma.marketItem.findMany({
        where: { sellerId },
        include: itemInclude,
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
      prisma.marketOrder.findMany({
        where: { sellerId },
        include: {
          item: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } },
          buyer: { select: MARKET_PUBLIC_USER_SELECT },
          offer: true,
          settlement: true,
          refunds: { orderBy: { createdAt: "desc" } },
          conversation: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.marketSettlement.findMany({
        where: { sellerId },
        include: { order: { include: { item: { select: { id: true, title: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.marketPayoutProfile.findUnique({
        where: { userId: sellerId },
        select: { method: true, accountMasked: true, realNameMasked: true, verified: true, updatedAt: true },
      }),
      getMarketConfig(),
    ]);

    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const pendingOrders = orders.filter((order) => ["paid", "delivering"].includes(order.status));
    const frozenOrders = orders.filter((order) => ["refund_pending", "disputed"].includes(order.status));
    const availableSettlements = settlements.filter((settlement) => settlement.status === "available");
    const heldSettlements = settlements.filter((settlement) => settlement.status === "held");
    const settledSettlements = settlements.filter((settlement) => settlement.status === "settled");
    const paidOrders = orders.filter((order) => Boolean(order.paidAt) && !["cancelled", "refunded"].includes(order.status));
    const timeline = [
      ...orders.filter((order) => Boolean(order.paidAt)).map((order) => ({
        key: `paid-${order.id}`,
        orderId: order.id,
        type: order.status === "refunded" ? "refunded" : "payment",
        title: order.item.title,
        amountCents: order.status === "refunded" ? -order.sellerAmountCents : order.sellerAmountCents,
        platformFeeCents: order.platformFeeCents,
        status: order.status,
        occurredAt: order.refundedAt || order.paidAt,
      })),
      ...settlements.map((settlement) => ({
        key: `settlement-${settlement.id}`,
        orderId: settlement.orderId,
        type: "settlement",
        title: settlement.order.item.title,
        amountCents: settlement.amountCents,
        platformFeeCents: settlement.order.platformFeeCents,
        status: settlement.status,
        occurredAt: settlement.settledAt || settlement.availableAt || settlement.createdAt,
        reference: settlement.reference,
      })),
    ].sort((a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime()).slice(0, 200);

    ok(res, {
      config: serializeMarketConfig(config),
      stats: {
        activeListings: items.filter((item) => item.status === "active").length,
        reservedListings: items.filter((item) => item.status === "reserved").length,
        soldListings: items.filter((item) => item.status === "sold").length,
        pendingDeliveryOrders: pendingOrders.length,
        pendingSettlementOrders: availableSettlements.length + heldSettlements.length,
      },
      balance: {
        grossCents: sum(paidOrders.map((order) => order.amountCents)),
        commissionCents: sum(paidOrders.map((order) => order.platformFeeCents)),
        pendingCents: sum(pendingOrders.map((order) => order.sellerAmountCents)),
        frozenCents: sum(frozenOrders.map((order) => order.sellerAmountCents)) + sum(heldSettlements.map((settlement) => settlement.amountCents)),
        availableCents: sum(availableSettlements.map((settlement) => settlement.amountCents)),
        settledCents: sum(settledSettlements.map((settlement) => settlement.amountCents)),
      },
      items: items.map((item) => serializeItem(item, sellerId)),
      orders: orders.map((order) => serializeOrder(order, sellerId, req.user!.role)),
      settlements: settlements.map((settlement) => ({ ...settlement, amount: amountCentsToMoney(settlement.amountCents), order: serializeOrder(settlement.order, sellerId, req.user!.role) })),
      timeline: timeline.map((entry) => ({
        ...entry,
        amount: amountCentsToMoney(Math.abs(entry.amountCents)),
        platformFee: amountCentsToMoney(entry.platformFeeCents),
      })),
      payoutProfile,
    });
  } catch (error) { next(error); }
});

const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), content: z.string().trim().max(500).optional().default("") });

marketRouter.get("/users/:id/profile", async (req, res, next) => {
  try {
    await refreshExpiredPromotions();
    const userId = Number(req.params.id);
    const promotionNow = new Date();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: MARKET_PUBLIC_USER_SELECT });
    if (!user) throw Errors.notFound("用户不存在");
    const [listingCount, completedTrades, reviews, positiveReviews, noShowCount, recentItems, merchant] = await Promise.all([
      prisma.marketItem.count({ where: { sellerId: userId, visibility: "public", status: { not: "hidden" } } }),
      prisma.marketOrder.count({ where: { status: "completed", OR: [{ buyerId: userId }, { sellerId: userId }] } }),
      prisma.marketReview.aggregate({ where: { targetUserId: userId }, _avg: { rating: true }, _count: true }),
      prisma.marketReview.count({ where: { targetUserId: userId, rating: { gte: 4 } } }),
      prisma.marketOrder.count({
        where: {
          status: "no_show",
          OR: [
            { buyerId: userId, noShowParty: "buyer" },
            { sellerId: userId, noShowParty: "seller" },
          ],
        },
      }),
      prisma.marketItem.findMany({
        where: { sellerId: userId, visibility: "public", status: { in: ["active", "reserved", "sold"] } },
        include: itemInclude,
        orderBy: { updatedAt: "desc" },
        take: 6,
      }),
      prisma.merchantProfile.findFirst({
        where: { userId, status: "approved", activeUntil: { gt: promotionNow }, activePromotionOrderId: { not: null }, activePromotionOrder: { is: { status: "confirmed", startsAt: { lte: promotionNow }, expiresAt: { gt: promotionNow } } } },
        select: { id: true, slug: true, name: true, category: true, activeUntil: true, activePromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } } },
      }),
    ]);
    ok(res, {
      user,
      stats: {
        listingCount,
        completedTrades,
        rating: reviews._avg.rating || 0,
        reviewCount: reviews._count,
        positiveRate: reviews._count ? Math.round((positiveReviews / reviews._count) * 100) : 0,
        noShowCount,
      },
      recentItems: recentItems.map((item) => serializeItem(item, req.user?.userId)),
      merchant: merchant ? { ...merchant, promotion: serializeMerchantPromotion(merchant) } : null,
    });
  } catch (error) { next(error); }
});

marketRouter.post("/orders/:id/reviews", authRequired, validate(reviewSchema), async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({ where: { id: orderId }, include: { item: true } });
    if (!order || (order.buyerId !== req.user!.userId && order.sellerId !== req.user!.userId)) throw Errors.notFound("订单不存在");
    if (order.status !== "completed") throw Errors.badRequest("交易完成后才能评价");
    const targetUserId = order.buyerId === req.user!.userId ? order.sellerId : order.buyerId;
    const review = await prisma.marketReview.create({ data: { orderId, authorId: req.user!.userId, targetUserId, rating: req.body.rating, content: req.body.content } }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("你已经评价过该交易");
      throw error;
    });
    await notify(targetUserId, "收到新的交易评价", `「${order.item.title}」的交易对方给出了 ${review.rating} 星评价`, `/market/mine?tab=orders`, { type: "market-review", orderId, reviewId: review.id });
    ok(res, review);
  } catch (error) { next(error); }
});

marketRouter.get("/users/:id/reviews", async (req, res, next) => {
  try {
    const targetUserId = Number(req.params.id);
    const [list, summary] = await Promise.all([
      prisma.marketReview.findMany({ where: { targetUserId }, include: { author: { select: MARKET_PUBLIC_USER_SELECT }, order: { include: { item: { select: { id: true, title: true } } } } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.marketReview.aggregate({ where: { targetUserId }, _avg: { rating: true }, _count: true }),
    ]);
    ok(res, { list, average: summary._avg.rating || 0, total: summary._count });
  } catch (error) { next(error); }
});

marketRouter.get("/users/:id/trust", async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    ok(res, await getMarketTrustProfile(prisma, userId, false));
  } catch (error) { next(error); }
});

marketRouter.get("/trust/me", authRequired, async (req, res, next) => {
  try {
    ok(res, await getMarketTrustProfile(prisma, req.user!.userId, true));
  } catch (error) { next(error); }
});

const marketContactSchema = z.object({
  method: z.enum(["wechat", "qq", "phone", "email", "other"]),
  value: z.string().trim().min(3).max(120),
});

marketRouter.patch("/contact-card", authRequired, validate(marketContactSchema), async (req, res, next) => {
  try {
    await requireVerifiedMarketUser(req.user!.userId, req.user!.role);
    const card = await prisma.marketContactCard.upsert({
      where: { userId: req.user!.userId },
      create: {
        userId: req.user!.userId,
        method: req.body.method,
        valueEncrypted: sealMarketContact(req.body.value),
        valueMasked: maskMarketContact(req.body.method, req.body.value),
      },
      update: {
        method: req.body.method,
        valueEncrypted: sealMarketContact(req.body.value),
        valueMasked: maskMarketContact(req.body.method, req.body.value),
      },
      select: { method: true, valueMasked: true, updatedAt: true },
    });
    ok(res, card);
  } catch (error) { next(error); }
});

marketRouter.get("/orders/:id/contact-cards", authRequired, async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        buyer: { select: MARKET_PUBLIC_USER_SELECT },
        seller: { select: MARKET_PUBLIC_USER_SELECT },
      },
    });
    if (!order || (order.buyerId !== req.user!.userId && order.sellerId !== req.user!.userId)) throw Errors.notFound("交易预约不存在");
    if (!PRIVATE_TRADE_STATUSES.includes(order.status)) throw Errors.forbidden("仅在卖家接受意向后的有效交易中开放联系方式");
    const cards = await prisma.marketContactCard.findMany({
      where: { userId: { in: [order.buyerId, order.sellerId] } },
      select: { userId: true, method: true, valueEncrypted: true, valueMasked: true, updatedAt: true },
    });
    const cardByUser = new Map(cards.map((card) => [card.userId, card]));
    const serializeCard = (user: any) => {
      const card = cardByUser.get(user.id);
      if (!card) return { user, contact: null };
      let value: string | null = null;
      try { value = openMarketContact(card.valueEncrypted); } catch { value = null; }
      return { user, contact: { method: card.method, value, valueMasked: card.valueMasked, updatedAt: card.updatedAt } };
    };
    const ownUser = order.buyerId === req.user!.userId ? order.buyer : order.seller;
    const counterpartUser = order.buyerId === req.user!.userId ? order.seller : order.buyer;
    ok(res, { orderId, own: serializeCard(ownUser), counterpart: serializeCard(counterpartUser) });
  } catch (error) { next(error); }
});

const appealSchema = z.object({ content: z.string().trim().min(10).max(2000) });
marketRouter.post("/violations/:id/appeals", authRequired, validate(appealSchema), async (req, res, next) => {
  try {
    const violationId = Number(req.params.id);
    const violation = await prisma.marketViolation.findUnique({ where: { id: violationId } });
    if (!violation || violation.userId !== req.user!.userId) throw Errors.notFound("违规记录不存在");
    if (violation.status !== "active") throw Errors.badRequest("该记录当前不能申诉");
    const appeal = await prisma.marketAppeal.create({
      data: { violationId, userId: req.user!.userId, content: req.body.content },
    }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("该违规记录已经提交过申诉");
      throw error;
    });
    const staff = await prisma.user.findMany({ where: { role: { in: ["admin", "mod"] } }, select: { id: true } });
    if (staff.length) await prisma.notification.createMany({ data: staff.map((user) => ({ userId: user.id, category: "market", level: "normal", title: "收到市集违规申诉", content: `违规记录 ${violationId} 收到新申诉`, link: "/admin?tab=market", source: "靠浦校园市集", payload: JSON.stringify({ type: "market-appeal", violationId, appealId: appeal.id }) })) });
    ok(res, appeal);
  } catch (error) { next(error); }
});

const reportSchema = z.object({ reason: z.string().trim().min(2).max(80), detail: z.string().trim().max(1000).optional().default("") });

async function notifyMarketStaffReport(title: string, content: string, payload: Record<string, unknown>) {
  const staff = await prisma.user.findMany({ where: { role: { in: ["admin", "mod"] } }, select: { id: true } });
  if (staff.length) await prisma.notification.createMany({ data: staff.map((user) => ({ userId: user.id, category: "market", level: "strong", title, content, link: "/admin?tab=market", source: "靠浦校园市集", payload: JSON.stringify(payload) })) });
}

marketRouter.post("/items/:id/reports", authRequired, validate(reportSchema), async (req, res, next) => {
  try {
    const itemId = Number(req.params.id);
    const item = await prisma.marketItem.findUnique({ where: { id: itemId } });
    if (!item) throw Errors.notFound("商品不存在");
    if (item.sellerId === req.user!.userId) throw Errors.badRequest("不能举报自己发布的商品");
    const report = await prisma.marketReport.create({ data: { itemId, reporterId: req.user!.userId, reportedUserId: item.sellerId, type: "listing", reason: req.body.reason, detail: req.body.detail } }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("你已经举报过该商品");
      throw error;
    });
    await notifyMarketStaffReport("收到商品举报", `「${item.title}」被举报：${req.body.reason}`, { type: "market-report", itemId, reportId: report.id });
    ok(res, report);
  } catch (error) { next(error); }
});

marketRouter.post("/wanted/:id/reports", authRequired, validate(reportSchema), async (req, res, next) => {
  try {
    const wantedPostId = Number(req.params.id);
    const post = await prisma.wantedPost.findUnique({ where: { id: wantedPostId } });
    if (!post) throw Errors.notFound("求购不存在");
    if (post.authorId === req.user!.userId) throw Errors.badRequest("不能举报自己发布的求购");
    const duplicate = await prisma.marketReport.findFirst({ where: { wantedPostId, reporterId: req.user!.userId } });
    if (duplicate) throw Errors.conflict("你已经举报过该求购");
    const report = await prisma.marketReport.create({ data: { wantedPostId, reporterId: req.user!.userId, reportedUserId: post.authorId, type: "wanted", reason: req.body.reason, detail: req.body.detail } });
    await notifyMarketStaffReport("收到求购举报", `「${post.title}」被举报：${req.body.reason}`, { type: "market-wanted-report", wantedPostId, reportId: report.id });
    ok(res, report);
  } catch (error) { next(error); }
});

marketRouter.post("/users/:id/reports", authRequired, validate(reportSchema), async (req, res, next) => {
  try {
    const reportedUserId = Number(req.params.id);
    if (reportedUserId === req.user!.userId) throw Errors.badRequest("不能举报自己");
    const user = await prisma.user.findUnique({ where: { id: reportedUserId }, select: MARKET_PUBLIC_USER_SELECT });
    if (!user) throw Errors.notFound("用户不存在");
    const duplicate = await prisma.marketReport.findFirst({ where: { type: "user", reportedUserId, reporterId: req.user!.userId, status: "pending" } });
    if (duplicate) throw Errors.conflict("你已经提交过对该用户的待处理举报");
    const report = await prisma.marketReport.create({ data: { reportedUserId, reporterId: req.user!.userId, type: "user", reason: req.body.reason, detail: req.body.detail } });
    await notifyMarketStaffReport("收到用户举报", `${user.nickname} 被举报：${req.body.reason}`, { type: "market-user-report", reportedUserId, reportId: report.id });
    ok(res, report);
  } catch (error) { next(error); }
});

marketRouter.post("/orders/:id/report", authRequired, validate(reportSchema), async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const order = await prisma.marketOrder.findUnique({ where: { id: orderId }, include: { item: { select: { title: true } } } });
    if (!order || (order.buyerId !== req.user!.userId && order.sellerId !== req.user!.userId)) throw Errors.notFound("交易记录不存在");
    const reportedUserId = order.buyerId === req.user!.userId ? order.sellerId : order.buyerId;
    const duplicate = await prisma.marketReport.findFirst({ where: { orderId, reporterId: req.user!.userId } });
    if (duplicate) throw Errors.conflict("你已经举报过该交易");
    const report = await prisma.marketReport.create({ data: { orderId, reporterId: req.user!.userId, reportedUserId, type: "trade", reason: req.body.reason, detail: req.body.detail } });
    await notifyMarketStaffReport("收到交易举报", `「${order.item.title}」的交易被举报：${req.body.reason}`, { type: "market-trade-report", orderId, reportId: report.id });
    ok(res, report);
  } catch (error) { next(error); }
});

function sensitiveKey() {
  return crypto.createHash("sha256").update(`xjtlu-market-payout:${config.jwtSecret}`).digest();
}

function sealSensitive(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sensitiveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function openSensitive(value: string) {
  const payload = Buffer.from(value, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", sensitiveKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

function maskAccount(value: string) {
  if (value.includes("@")) {
    const [name, host] = value.split("@", 2);
    return `${name.slice(0, 2)}***@${host}`;
  }
  return value.length <= 6 ? `${value.slice(0, 1)}***${value.slice(-1)}` : `${value.slice(0, 3)}****${value.slice(-3)}`;
}

function maskName(value: string) {
  return value.length <= 1 ? "*" : `${value.slice(0, 1)}${"*".repeat(Math.min(3, value.length - 1))}`;
}

const payoutSchema = z.object({ method: z.enum(["alipay", "wxpay", "bank"]), account: z.string().trim().min(3).max(120), realName: z.string().trim().min(1).max(80) });

marketRouter.patch("/payout-profile", authRequired, validate(payoutSchema), async (req, res, next) => {
  try {
    if (!STUDENT_MARKET_PAYMENT_ENABLED) throw Errors.forbidden("学生商品不使用平台结算或提现，无需保存收款资料");
    const userId = req.user!.userId;
    const profile = await prisma.marketPayoutProfile.upsert({
      where: { userId },
      create: { userId, method: req.body.method, accountEncrypted: sealSensitive(req.body.account), accountMasked: maskAccount(req.body.account), realNameEncrypted: sealSensitive(req.body.realName), realNameMasked: maskName(req.body.realName), verified: false },
      update: { method: req.body.method, accountEncrypted: sealSensitive(req.body.account), accountMasked: maskAccount(req.body.account), realNameEncrypted: sealSensitive(req.body.realName), realNameMasked: maskName(req.body.realName), verified: false },
      select: { method: true, accountMasked: true, realNameMasked: true, verified: true, updatedAt: true },
    });
    ok(res, profile);
  } catch (error) { next(error); }
});

function requireStaff(role: string) {
  if (!["admin", "mod"].includes(role)) throw Errors.forbidden("需要商城管理权限");
}

marketRouter.get("/admin/config", authRequired, async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    ok(res, serializeMarketConfig(await getMarketConfig()));
  } catch (error) { next(error); }
});

marketRouter.patch("/admin/config", authRequired, validate(z.object({
  learningMaterialCommissionRate: z.literal(0),
})), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const learningMaterialCommissionBps = 0;
    const config = await prisma.marketConfig.upsert({
      where: { id: MARKET_CONFIG_ID },
      update: { commissionBps: 0, learningMaterialCommissionBps },
      create: { id: MARKET_CONFIG_ID, commissionBps: 0, learningMaterialCommissionBps },
    });
    ok(res, serializeMarketConfig(config));
  } catch (error) { next(error); }
});

const categoryCreateSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(1).max(30),
  icon: z.string().trim().min(1).max(12).default("📦"),
  description: z.string().trim().max(120).default(""),
  fulfillmentType: z.literal("physical").default("physical"),
  imageRequired: z.boolean().default(true),
  enabled: z.boolean().default(true),
  sort: z.number().int().min(0).max(9999).default(0),
});
const categoryPatchSchema = categoryCreateSchema.omit({ slug: true }).partial();

marketRouter.get("/admin/categories", authRequired, async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    await ensureMarketCategories();
    const list = await prisma.marketCategory.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] });
    const counts = await prisma.marketItem.groupBy({ by: ["category"], _count: { _all: true } });
    const countMap = new Map(counts.map((row) => [row.category, row._count._all]));
    ok(res, list.map((category) => ({ ...category, itemCount: countMap.get(category.slug) || 0 })));
  } catch (error) { next(error); }
});

marketRouter.post("/admin/categories", authRequired, validate(categoryCreateSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const category = await prisma.marketCategory.create({ data: req.body }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("品类标识已存在");
      throw error;
    });
    ok(res, { ...category, itemCount: 0 });
  } catch (error) { next(error); }
});

marketRouter.patch("/admin/categories/:id", authRequired, validate(categoryPatchSchema), async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const current = await prisma.marketCategory.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("品类不存在");
    if (current.fulfillmentType === "digital") throw Errors.forbidden("历史数字品类已冻结，不能修改或重新启用");
    const category = await prisma.marketCategory.update({ where: { id }, data: req.body }).catch((error: any) => {
      if (String(error?.code) === "P2025") throw Errors.notFound("品类不存在");
      throw error;
    });
    ok(res, category);
  } catch (error) { next(error); }
});

marketRouter.delete("/admin/categories/:id", authRequired, async (req, res, next) => {
  try {
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const category = await prisma.marketCategory.findUnique({ where: { id } });
    if (!category) throw Errors.notFound("品类不存在");
    if (category.fulfillmentType === "digital") throw Errors.forbidden("历史数字品类已冻结，不能删除");
    const itemCount = await prisma.marketItem.count({ where: { category: category.slug } });
    if (itemCount) throw Errors.conflict("该品类下已有商品，请先停用品类，不能直接删除");
    await prisma.marketCategory.delete({ where: { id } });
    ok(res, { ok: true });
  } catch (error) { next(error); }
});

marketRouter.get("/admin/overview", authRequired, async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const [counts, reports, refunds, settlements, orders, reviewItems, expiredItems, wantedModeration, safetyRules, violations, appeals, actionLogs] = await Promise.all([
      Promise.all(["reviewing", "active", "reserved", "sold", "expired", "hidden"].map(async (status) => [status, await prisma.marketItem.count({ where: { status, visibility: "public" } })])),
      prisma.marketReport.findMany({ include: { item: { select: { id: true, title: true, status: true } }, wantedPost: { select: { id: true, title: true, status: true } }, order: { select: { id: true, outTradeNo: true, status: true } }, reportedUser: { select: MARKET_PUBLIC_USER_SELECT }, reporter: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketRefund.findMany({ include: { order: { include: { item: { select: { id: true, title: true } }, buyer: { select: MARKET_PUBLIC_USER_SELECT }, seller: { select: MARKET_PUBLIC_USER_SELECT } } }, requestedBy: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketSettlement.findMany({ include: { order: { include: { item: { select: { id: true, title: true } } } }, seller: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketOrder.findMany({ include: { item: { select: { id: true, title: true } }, buyer: { select: MARKET_PUBLIC_USER_SELECT }, seller: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketItem.findMany({ where: { status: "reviewing", visibility: "public" }, include: itemInclude, orderBy: { createdAt: "asc" }, take: 100 }),
      prisma.marketItem.findMany({ where: { status: "expired", visibility: "public" }, include: itemInclude, orderBy: { expiresAt: "desc" }, take: 100 }),
      prisma.wantedPost.findMany({
        where: { status: { in: ["reviewing", "expired", "removed"] } },
        include: { author: { select: MARKET_PUBLIC_USER_SELECT }, _count: { select: { responses: true } } },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.marketSafetyRule.findMany({ include: { createdBy: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: [{ enabled: "desc" }, { id: "asc" }] }),
      prisma.marketViolation.findMany({ include: { user: { select: MARKET_PUBLIC_USER_SELECT }, createdBy: { select: MARKET_PUBLIC_USER_SELECT }, item: { select: { id: true, title: true } }, wantedPost: { select: { id: true, title: true } }, order: { select: { id: true, outTradeNo: true } }, _count: { select: { appeals: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketAppeal.findMany({ include: { user: { select: MARKET_PUBLIC_USER_SELECT }, violation: true, handledBy: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.adminActionLog.findMany({ include: { actor: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    ok(res, {
      counts: Object.fromEntries(counts),
      reports,
      refunds: refunds.map((refund) => ({ ...refund, amount: amountCentsToMoney(refund.amountCents) })),
      settlements: settlements.map((settlement) => ({ ...settlement, amount: amountCentsToMoney(settlement.amountCents), order: serializeOrder(settlement.order) })),
      orders: orders.map((order) => serializeOrder(order)),
      reviewItems: reviewItems.map((item) => serializeItem(item)),
      expiredItems: expiredItems.map((item) => serializeItem(item)),
      wantedModeration: wantedModeration.map((post) => serializeWantedPost(post)),
      safetyRules,
      violations,
      appeals,
      actionLogs,
    });
  } catch (error) { next(error); }
});

const safetyRuleSchema = z.object({
  keyword: z.string().trim().min(1).max(80),
  scope: z.enum(["market", "forum", "learning", "all"]).default("market"),
  category: z.string().trim().min(1).max(80).default("prohibited"),
  action: z.enum(["block", "review"]).default("block"),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(500).default(""),
});

marketRouter.post("/admin/safety-rules", authRequired, validate(safetyRuleSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const rule = await prisma.marketSafetyRule.create({ data: { ...req.body, createdById: req.user!.userId } }).catch((error: any) => {
      if (String(error?.code) === "P2002") throw Errors.conflict("该关键词规则已存在");
      throw error;
    });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.safety_rule.create", targetType: "market_safety_rule", targetId: rule.id, summary: `新增市集安全规则：${rule.keyword}`, detail: { category: rule.category, action: rule.action, enabled: rule.enabled }, ip: requestIp(req) });
    ok(res, rule);
  } catch (error) { next(error); }
});

marketRouter.patch("/admin/safety-rules/:id", authRequired, validate(safetyRuleSchema.partial()), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const rule = await prisma.marketSafetyRule.update({ where: { id }, data: req.body }).catch((error: any) => {
      if (String(error?.code) === "P2025") throw Errors.notFound("安全规则不存在");
      if (String(error?.code) === "P2002") throw Errors.conflict("该关键词规则已存在");
      throw error;
    });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.safety_rule.update", targetType: "market_safety_rule", targetId: id, summary: `更新市集安全规则：${rule.keyword}`, detail: req.body, ip: requestIp(req) });
    ok(res, rule);
  } catch (error) { next(error); }
});

marketRouter.delete("/admin/safety-rules/:id", authRequired, async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const rule = await prisma.marketSafetyRule.delete({ where: { id } }).catch((error: any) => {
      if (String(error?.code) === "P2025") throw Errors.notFound("安全规则不存在");
      throw error;
    });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.safety_rule.delete", targetType: "market_safety_rule", targetId: id, summary: `删除市集安全规则：${rule.keyword}`, detail: { category: rule.category, action: rule.action }, ip: requestIp(req) });
    ok(res, { ok: true });
  } catch (error) { next(error); }
});

const violationCreateSchema = z.object({
  userId: z.number().int().positive(),
  itemId: z.number().int().positive().optional().nullable(),
  wantedPostId: z.number().int().positive().optional().nullable(),
  orderId: z.number().int().positive().optional().nullable(),
  type: z.string().trim().min(2).max(80),
  level: z.enum(["warning", "moderate", "serious"]).default("warning"),
  action: z.enum(["warning", "restrict_publish", "restrict_trade"]).default("warning"),
  reason: z.string().trim().min(2).max(500),
  expiresAt: z.coerce.date().optional().nullable(),
});

marketRouter.post("/admin/violations", authRequired, validate(violationCreateSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const target = await prisma.user.findUnique({ where: { id: req.body.userId }, select: MARKET_PUBLIC_USER_SELECT });
    if (!target) throw Errors.notFound("处理对象不存在");
    if (req.body.expiresAt && req.body.expiresAt <= new Date()) throw Errors.badRequest("限制结束时间必须晚于当前时间");
    const violation = await prisma.marketViolation.create({ data: { ...req.body, createdById: req.user!.userId } });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.violation.create", targetType: "user", targetId: target.id, summary: `记录市集违规：${target.nickname}`, detail: { violationId: violation.id, type: violation.type, level: violation.level, action: violation.action, reason: violation.reason, expiresAt: violation.expiresAt }, ip: requestIp(req) });
    await notify(target.id, "市集账号收到处理提醒", `${violation.reason}${violation.expiresAt ? `；限制至 ${violation.expiresAt.toLocaleString("zh-CN")}` : ""}`, "/market/mine?tab=trust", { type: "market-violation", violationId: violation.id, action: violation.action });
    ok(res, violation);
  } catch (error) { next(error); }
});

marketRouter.patch("/admin/violations/:id", authRequired, validate(z.object({ status: z.literal("revoked"), note: z.string().trim().max(500).optional().default("") })), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const current = await prisma.marketViolation.findUnique({ where: { id }, include: { user: { select: MARKET_PUBLIC_USER_SELECT } } });
    if (!current) throw Errors.notFound("违规记录不存在");
    const violation = await prisma.marketViolation.update({ where: { id }, data: { status: "revoked", revokedAt: new Date() } });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.violation.revoke", targetType: "user", targetId: current.userId, summary: `撤销市集处理：${current.user.nickname}`, detail: { violationId: id, note: req.body.note }, ip: requestIp(req) });
    await notify(current.userId, "市集账号处理已撤销", req.body.note || "管理员已撤销该条市集处理", "/market/mine?tab=trust", { type: "market-violation-revoked", violationId: id });
    ok(res, violation);
  } catch (error) { next(error); }
});

const appealActionSchema = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().trim().min(2).max(500) });
marketRouter.patch("/admin/appeals/:id", authRequired, validate(appealActionSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const current = await prisma.marketAppeal.findUnique({ where: { id }, include: { violation: true, user: { select: MARKET_PUBLIC_USER_SELECT } } });
    if (!current) throw Errors.notFound("申诉不存在");
    if (current.status !== "pending") throw Errors.badRequest("该申诉已经处理");
    const appeal = await prisma.$transaction(async (tx) => {
      const updated = await tx.marketAppeal.update({ where: { id }, data: { status: req.body.status, handledById: req.user!.userId, handledNote: req.body.note, handledAt: new Date() } });
      if (req.body.status === "approved") await tx.marketViolation.update({ where: { id: current.violationId }, data: { status: "revoked", revokedAt: new Date() } });
      return updated;
    });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: `market.appeal.${req.body.status}`, targetType: "market_appeal", targetId: id, summary: `处理市集申诉：${current.user.nickname}`, detail: { violationId: current.violationId, status: req.body.status, note: req.body.note }, ip: requestIp(req) });
    await notify(current.userId, "市集申诉已有结果", `申诉结果：${req.body.status === "approved" ? "通过" : "未通过"}；${req.body.note}`, "/market/mine?tab=trust", { type: "market-appeal-result", appealId: id, status: req.body.status });
    ok(res, appeal);
  } catch (error) { next(error); }
});

marketRouter.get("/admin/action-logs", authRequired, async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 30, 1, 100);
    const [total, list] = await Promise.all([
      prisma.adminActionLog.count(),
      prisma.adminActionLog.findMany({ include: { actor: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * size, take: size }),
    ]);
    ok(res, { page, size, total, list });
  } catch (error) { next(error); }
});

const adminItemSchema = z.object({ status: z.enum(ITEM_STATUSES), note: z.string().trim().max(500).optional().default("") });
marketRouter.patch("/admin/items/:id", authRequired, validate(adminItemSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const item = await prisma.marketItem.update({
      where: { id },
      data: {
        status: req.body.status,
        soldAt: req.body.status === "sold" ? new Date() : undefined,
        moderationNote: req.body.note,
        moderatedAt: new Date(),
        expiresAt: req.body.status === "active" ? null : undefined,
      },
      include: itemInclude,
    });
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.item.moderate", targetType: "market_item", targetId: id, summary: `调整商品状态：${item.title}`, detail: { status: req.body.status, note: req.body.note }, ip: requestIp(req) });
    await notify(item.sellerId, "商品状态已更新", `「${item.title}」已被管理员调整为 ${req.body.status}${req.body.note ? `：${req.body.note}` : ""}`, `/market/item/${id}`, { type: "market-admin-item", itemId: id, status: req.body.status });
    ok(res, serializeItem(item));
  } catch (error) { next(error); }
});

const adminWantedSchema = z.object({
  status: z.enum(["reviewing", "active", "expired", "removed"]),
  note: z.string().trim().max(500).optional().default(""),
});
marketRouter.patch("/admin/wanted/:id", authRequired, validate(adminWantedSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const post = await prisma.wantedPost.update({
      where: { id },
      data: {
        status: req.body.status,
        moderationNote: req.body.note,
        moderatedAt: new Date(),
        expiresAt: req.body.status === "active" ? nextWantedExpiry() : undefined,
      },
      include: { author: { select: MARKET_PUBLIC_USER_SELECT }, _count: { select: { responses: true } } },
    });
    if (req.body.status === "removed") {
      await prisma.wantedResponse.updateMany({ where: { wantedPostId: id, status: "pending" }, data: { status: "expired" } });
    }
    const topic = await syncPersistedWantedDemandTopic(post);
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.wanted.moderate", targetType: "wanted_post", targetId: id, summary: `调整求购状态：${post.title}`, detail: { status: req.body.status, note: req.body.note }, ip: requestIp(req) });
    await notify(post.authorId, "求购状态已更新", `「${post.title}」已被管理员调整为 ${req.body.status}${req.body.note ? `：${req.body.note}` : ""}`, `/forum/topic/${topic.id}`, { type: "market-admin-wanted", wantedPostId: id, topicId: topic.id, status: req.body.status });
    ok(res, serializeWantedPost({ ...post, topicId: topic.id }));
  } catch (error) { next(error); }
});

const adminReportSchema = z.object({ status: z.enum(["resolved", "rejected"]), note: z.string().trim().max(500).optional().default(""), hideItem: z.boolean().optional().default(false) });
marketRouter.patch("/admin/reports/:id", authRequired, validate(adminReportSchema), async (req, res, next) => {
  try {
    requireStaff(req.user!.role);
    const id = Number(req.params.id);
    const report = await prisma.marketReport.update({ where: { id }, data: { status: req.body.status, handledById: req.user!.userId, handledNote: req.body.note, handledAt: new Date() } });
    if (req.body.hideItem && report.itemId) await prisma.marketItem.update({ where: { id: report.itemId }, data: { status: "hidden" } });
    if (req.body.hideItem && report.wantedPostId) {
      const removedWanted = await prisma.wantedPost.update({
        where: { id: report.wantedPostId },
        data: { status: "removed", moderationNote: req.body.note, moderatedAt: new Date() },
      });
      await syncPersistedWantedDemandTopic(removedWanted);
    }
    await logMarketAdminAction(prisma, { actorId: req.user!.userId, action: "market.report.handle", targetType: "market_report", targetId: id, summary: `处理市集举报：${report.type}`, detail: { status: req.body.status, hideTarget: req.body.hideItem, note: req.body.note }, ip: requestIp(req) });
    const reportLink = report.itemId ? `/market/item/${report.itemId}` : report.wantedPostId ? `/market/wanted/${report.wantedPostId}` : "/market/mine?tab=trust";
    await notify(report.reporterId, "市集举报已处理", `你的举报已被标记为 ${req.body.status}${req.body.note ? `：${req.body.note}` : ""}`, reportLink, { type: "market-report-result", reportId: id });
    ok(res, report);
  } catch (error) { next(error); }
});

const adminRefundSchema = z.object({ status: z.enum(["approved", "completed", "rejected", "failed"]), providerRefundNo: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional().default("") });
marketRouter.patch("/admin/refunds/:id", authRequired, validate(adminRefundSchema), async (req, res, next) => {
  try {
    if (!STUDENT_MARKET_PAYMENT_ENABLED) throw Errors.forbidden("学生商品支付与退款后台已冻结，仅保留历史记录只读查询");
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const current = await prisma.marketRefund.findUnique({ where: { id }, include: { order: { include: { item: true } } } });
    if (!current) throw Errors.notFound("退款申请不存在");
    const refund = await prisma.$transaction(async (tx) => {
      const updated = await tx.marketRefund.update({ where: { id }, data: { status: req.body.status, providerRefundNo: req.body.providerRefundNo || current.providerRefundNo, handledById: req.user!.userId, handledNote: req.body.note, handledAt: new Date() } });
      if (req.body.status === "completed") {
        await tx.marketOrder.update({ where: { id: current.orderId }, data: { status: "refunded", refundedAt: new Date() } });
        await tx.marketItem.update({ where: { id: current.order.itemId }, data: { status: "active" } });
        await tx.learningMaterialAccess.updateMany({ where: { orderId: current.orderId }, data: { revokedAt: new Date() } });
      } else if (req.body.status === "rejected" || req.body.status === "failed") {
        await tx.marketOrder.update({ where: { id: current.orderId }, data: { status: current.order.paidAt ? "paid" : "cancelled" } });
      }
      return updated;
    });
    await notify(current.order.buyerId, "退款状态已更新", `「${current.order.item.title}」退款申请：${req.body.status}${req.body.note ? `，${req.body.note}` : ""}`, `/market/mine?tab=orders`, { type: "market-refund-result", orderId: current.orderId, refundId: id });
    ok(res, refund);
  } catch (error) { next(error); }
});

const settlementSchema = z.object({ status: z.enum(["available", "held", "settled"]), reference: z.string().trim().max(120).optional().default(""), note: z.string().trim().max(500).optional().default("") });
marketRouter.patch("/admin/settlements/:id", authRequired, validate(settlementSchema), async (req, res, next) => {
  try {
    if (!STUDENT_MARKET_PAYMENT_ENABLED) throw Errors.forbidden("学生商品结算后台已冻结，仅保留历史记录只读查询");
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const id = Number(req.params.id);
    const settlement = await prisma.marketSettlement.update({ where: { id }, data: { status: req.body.status, reference: req.body.reference, note: req.body.note, settledAt: req.body.status === "settled" ? new Date() : undefined }, include: { order: { include: { item: true } } } });
    await notify(settlement.sellerId, "商城结算状态已更新", `「${settlement.order.item.title}」结算状态：${req.body.status}`, `/market/mine?tab=selling`, { type: "market-settlement", settlementId: id, orderId: settlement.orderId });
    ok(res, { ...settlement, amount: amountCentsToMoney(settlement.amountCents) });
  } catch (error) { next(error); }
});

marketRouter.get("/admin/settlements/:id/payout-profile", authRequired, async (req, res, next) => {
  try {
    if (!STUDENT_MARKET_PAYMENT_ENABLED) throw Errors.forbidden("学生商品结算后台已冻结");
    if (req.user!.role !== "admin") throw Errors.forbidden("需要管理员权限");
    const settlement = await prisma.marketSettlement.findUnique({ where: { id: Number(req.params.id) }, include: { seller: { include: { marketPayoutProfile: true } } } });
    if (!settlement) throw Errors.notFound("结算单不存在");
    const profile = settlement.seller.marketPayoutProfile;
    if (!profile) throw Errors.notFound("卖家尚未设置收款资料");
    ok(res, { method: profile.method, account: openSensitive(profile.accountEncrypted), realName: openSensitive(profile.realNameEncrypted), verified: profile.verified });
  } catch (error) { next(error); }
});
