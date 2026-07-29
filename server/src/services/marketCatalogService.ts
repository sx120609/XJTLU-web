import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { splitMarketCategories } from "./marketCatalog";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import {
  refreshExpiredPromotions,
  serializeItemPromotions,
} from "./promotion";
import { STUDENT_MARKET_PAYMENT_ENABLED } from "./marketPolicy";
import { sweepMarketLifecycle } from "./marketLifecycle";
import {
  isMarketCampus,
  MARKET_CAMPUSES,
  normalizeMarketCampus,
} from "./marketCampus";

/**
 * Shared marketplace catalog rules and serializers.
 *
 * Both public reads and authenticated write flows use this module so moving
 * the public routes cannot silently change validation or response fields.
 */
export const ITEM_CONDITIONS = ["new", "like_new", "good", "fair"] as const;
export const TRADE_MODES = ["meetup", "shipping", "online", "any"] as const;
export const LISTING_TYPES = ["sell", "wanted"] as const;

const MARKET_CONFIG_ID = 1;
const DEFAULT_COMMISSION_BPS = 0;
const DEFAULT_LEARNING_MATERIAL_COMMISSION_BPS = 0;
const DEFAULT_CATEGORIES = [
  { slug: "digital", name: "数码 3C", icon: "💻", description: "手机、电脑、数码配件", fulfillmentType: "physical", imageRequired: true, sort: 10 },
  { slug: "books", name: "教材书籍", icon: "📚", description: "教材、课外书与纸质资料", fulfillmentType: "physical", imageRequired: true, sort: 20 },
  { slug: "digital_goods", name: "付费学习资料", icon: "📁", description: "经创作者认证与人工审核的校园学习资料，卖家确认收款后自动交付", fulfillmentType: "digital", imageRequired: false, enabled: true, sort: 30 },
  { slug: "dorm", name: "宿舍用品", icon: "🛏️", description: "宿舍与日常生活用品", fulfillmentType: "physical", imageRequired: true, sort: 40 },
  { slug: "appliance", name: "小家电", icon: "🔌", description: "小型电器与配件", fulfillmentType: "physical", imageRequired: true, sort: 50 },
  { slug: "fashion", name: "服饰鞋包", icon: "👕", description: "服饰、鞋履与箱包", fulfillmentType: "physical", imageRequired: true, sort: 60 },
  { slug: "sports", name: "运动户外", icon: "🏸", description: "运动器材与户外用品", fulfillmentType: "physical", imageRequired: true, sort: 70 },
  { slug: "tickets", name: "票务卡券", icon: "🎫", description: "合规票券与校园卡券", fulfillmentType: "physical", imageRequired: true, sort: 80 },
  { slug: "other", name: "其他商品", icon: "📦", description: "未归入其他分类的商品", fulfillmentType: "physical", imageRequired: true, sort: 90 },
] as const;

export const itemInclude: any = {
  seller: { select: MARKET_PUBLIC_USER_SELECT },
  images: { orderBy: [{ sort: "asc" as const }, { id: "asc" as const }] },
  topic: { select: { id: true, replyCount: true, likeCount: true, hidden: true, aiReviewStatus: true } },
  pinnedPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
  homePromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
  _count: { select: { favorites: true, offers: true, tradeIntents: true } },
} as const;

export function normalizeMarketTradeMode(value: unknown) {
  const input = String(value ?? "").trim();
  return input === "both" ? "any" : input;
}

export function queryMarketCampus(value: unknown) {
  const campus = normalizeMarketCampus(value);
  if (!campus) return "";
  if (!isMarketCampus(campus)) throw Errors.badRequest("校区仅支持 SIP 或 TC");
  return campus;
}

export function cents(value: string | number | null | undefined, allowZero = true) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount <= 0)) {
    throw Errors.badRequest("价格格式不正确");
  }
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

export function serializeItem(item: any, viewerId?: number) {
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
    favorited: Array.isArray(item.favorites)
      ? item.favorites.some((favorite: any) => favorite.userId === viewerId)
      : false,
    mine: Boolean(viewerId && viewerId === item.sellerId),
    soldAt: item.soldAt,
    promotions: serializeItemPromotions(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function ensureMarketCategories() {
  await Promise.all(DEFAULT_CATEGORIES.map((category) => prisma.marketCategory.upsert({
    where: { slug: category.slug },
    update: category.slug === "digital_goods"
      ? { name: category.name, description: category.description, icon: category.icon, enabled: true }
      : {},
    create: category,
  })));
}

export async function getMarketCategory(slug: string, includeDisabled = false) {
  await ensureMarketCategories();
  const category = await prisma.marketCategory.findUnique({ where: { slug } });
  if (!category || (!includeDisabled && !category.enabled)) {
    throw Errors.badRequest("请选择有效的商品品类");
  }
  return category;
}

export async function getMarketConfig() {
  return prisma.marketConfig.upsert({
    where: { id: MARKET_CONFIG_ID },
    update: { commissionBps: 0, learningMaterialCommissionBps: 0 },
    create: {
      id: MARKET_CONFIG_ID,
      commissionBps: DEFAULT_COMMISSION_BPS,
      learningMaterialCommissionBps: DEFAULT_LEARNING_MATERIAL_COMMISSION_BPS,
    },
  });
}

export function serializeMarketConfig(config: {
  commissionBps: number;
  learningMaterialCommissionBps: number;
  updatedAt: Date;
}) {
  return {
    commissionBps: config.commissionBps,
    commissionRate: config.commissionBps / 100,
    learningMaterialCommissionBps: config.learningMaterialCommissionBps,
    learningMaterialCommissionRate: config.learningMaterialCommissionBps / 100,
    updatedAt: config.updatedAt,
  };
}

export function buildMarketMeta(
  allCategories: Array<{
    id: number;
    slug: string;
    name: string;
    icon: string;
    description: string;
    fulfillmentType: string;
    imageRequired: boolean;
    enabled: boolean;
    sort: number;
    createdAt: Date;
    updatedAt: Date;
  }>,
  marketConfig: {
    commissionBps: number;
    learningMaterialCommissionBps: number;
    updatedAt: Date;
  },
) {
  const { market: categories } = splitMarketCategories(allCategories);
  return {
    categories,
    campuses: MARKET_CAMPUSES,
    featuredLearningMaterials: null,
    conditions: ITEM_CONDITIONS,
    tradeModes: TRADE_MODES,
    listingTypes: LISTING_TYPES,
    payTypes: [],
    paymentEnabled: STUDENT_MARKET_PAYMENT_ENABLED,
    ...serializeMarketConfig(marketConfig),
  };
}

export async function closeExpiredMarketOrders() {
  await Promise.all([sweepMarketLifecycle(prisma), refreshExpiredPromotions()]);
}
