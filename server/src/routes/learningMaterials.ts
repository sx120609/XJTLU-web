import crypto from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger, queryPage, querySize } from "../utils/query";
import { isFeatureOn } from "../services/siteSettings";
import { ensureUserCanSpeak } from "../services/userModeration";
import {
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
} from "../services/topicAiReview";
import { amountCentsToMoney } from "../services/epay";
import {
  DEFAULT_LEARNING_MATERIAL_TYPES,
  LEARNING_MATERIAL_FORMATS,
  LEARNING_MATERIAL_LANGUAGES,
  LEARNING_MATERIAL_ORIGINALITY,
  LEARNING_MATERIAL_SEMESTERS,
  LEARNING_MATERIAL_SUPPORT_CATEGORIES,
  containsOffPlatformContact,
  isAllowedLearningMaterialFile,
  learningMaterialFileFormat,
  learningMaterialProfileInputSchema,
  normalizeCourseCode,
  normalizeDeclaredFormats,
  normalizeMaterialTypeName,
  parseDeclaredFormats,
  publishedMaterialProfileErrors,
  supportCategoryIsFinancial,
  validateCustomMaterialTypeName,
  type LearningMaterialProfileInput,
} from "../services/learningMaterials";
import { normalizeMulterOriginalNames } from "../utils/uploadFilename";
import { MARKET_PUBLIC_USER_SELECT } from "../services/marketPublicUser";
import {
  PAID_LEARNING_MATERIALS_ENABLED,
  PAID_MATERIAL_DISABLED_MESSAGE,
  LEARNING_MATERIAL_MAX_PRICE_CENTS,
  LEARNING_MATERIAL_MIN_PRICE_CENTS,
  isAllowedLearningMaterialPrice,
} from "../services/marketPolicy";
import { acquireMarketOrderLock } from "../services/marketOrderLockService";
import { evaluateMarketContent } from "../services/marketTrust";
import {
  createPaidLearningOrder,
  submitMaterialVersionReview,
} from "../services/learningCommerceService";
import { normalizeIdempotencyKey } from "../services/learningCommerceContracts";
import { requestIdFromResponse } from "../middleware/requestObservability";
import { config } from "../config";
import {
  createLearningPdfSample,
  createLicensedLearningPdf,
  hashLearningAccessValue,
  inspectLearningPdf,
  newLearningWatermarkCode,
  validateLearningPdfPreviewRange,
} from "../services/learningMaterialPdfService";
import { listLearningMaterialRatings } from "../services/learningTrustService";

export const learningMaterialsRouter = Router();
const materialStaffRequired: RequestHandler = (req, _res, next) => {
  if (!req.user || !["admin", "mod"].includes(req.user.role)) return next(Errors.forbidden("需要学习资料运营权限"));
  next();
};

const CATEGORY = "digital_goods";
const ITEM_STATUSES = ["draft", "reviewing", "active", "reserved", "sold", "withdrawn", "hidden"] as const;
const PRIVATE_MATERIAL_ROOT = path.resolve(process.cwd(), "runtime", "learning-materials");
const PRIVATE_MATERIAL_UPLOAD_TMP = path.resolve(process.cwd(), "runtime", "learning-material-upload-tmp");
const MAX_MATERIAL_FILE_BYTES = 100 * 1024 * 1024;
mkdirSync(PRIVATE_MATERIAL_UPLOAD_TMP, { recursive: true });

async function ensureLearningMaterialCategory() {
  return prisma.marketCategory.upsert({
    where: { slug: CATEGORY },
    update: {
      name: "付费学习资料",
      icon: "📁",
      description: "通过创作者认证与人工审核的校园学习资料，卖家确认收款后自动交付",
      fulfillmentType: "digital",
      imageRequired: false,
      enabled: true,
      sort: 30,
    },
    create: {
      slug: CATEGORY,
      name: "付费学习资料",
      icon: "📁",
      description: "通过创作者认证与人工审核的校园学习资料，卖家确认收款后自动交付",
      fulfillmentType: "digital",
      imageRequired: false,
      enabled: true,
      sort: 30,
    },
  });
}

const materialFileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, PRIVATE_MATERIAL_UPLOAD_TMP),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_MATERIAL_FILE_BYTES, files: 10 },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedLearningMaterialFile(file.originalname)) return callback(Errors.badRequest("仅支持 PDF、Office、ZIP、TXT、Markdown 和常见图片格式") as any);
    callback(null, true);
  },
});

const safeFileSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  fileSize: true,
  format: true,
  pageCount: true,
  previewEnabled: true,
  previewPageStart: true,
  previewPageEnd: true,
  status: true,
  createdAt: true,
} as const;

function materialItemInclude(viewerId?: number): any {
  return {
    seller: {
      select: {
        ...MARKET_PUBLIC_USER_SELECT,
        learningCreatorProfile: {
          select: {
            status: true,
            certifiedAt: true,
            level: true,
            qualityScore: true,
            completedOrderCount: true,
            ratingCount: true,
            averageRatingBps: true,
            refundRateBps: true,
            disputeRateBps: true,
            averageConfirmMinutes: true,
          },
        },
      },
    },
    images: { orderBy: [{ sort: "asc" as const }, { id: "asc" as const }] },
    topic: { select: { id: true, replyCount: true, likeCount: true, hidden: true, aiReviewStatus: true } },
    favorites: viewerId ? { where: { userId: viewerId }, select: { userId: true } } : false,
    _count: { select: { favorites: true, offers: true } },
    learningMaterial: {
      include: {
        type: true,
        activeVersion: {
          include: {
            files: { where: { status: "active" }, select: safeFileSelect, orderBy: { id: "asc" as const } },
            reviews: {
              orderBy: [{ round: "desc" as const }, { id: "desc" as const }],
              take: 1,
              select: { id: true, status: true, reason: true, reviewedAt: true },
            },
          },
        },
        versions: {
          where: { status: "draft" },
          orderBy: [{ versionNumber: "desc" as const }, { id: "desc" as const }],
          take: 1,
          include: {
            files: { where: { status: "active" }, select: safeFileSelect, orderBy: { id: "asc" as const } },
            reviews: {
              orderBy: [{ round: "desc" as const }, { id: "desc" as const }],
              take: 1,
              select: { id: true, status: true, reason: true, reviewedAt: true },
            },
          },
        },
      },
    },
  };
}

const imageUrlSchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  "图片地址格式不正确",
);

const materialItemInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(20000),
  price: z.union([z.string(), z.number()]),
  originalPrice: z.union([z.string(), z.number()]).optional().nullable(),
  images: z.array(imageUrlSchema).max(9).optional().default([]),
  profile: learningMaterialProfileInputSchema,
  draft: z.boolean().optional().default(false),
});

const materialItemPatchSchema = materialItemInputSchema.partial().extend({
  status: z.enum(ITEM_STATUSES).optional(),
});

function priceCents(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 999999) throw Errors.badRequest("价格格式不正确");
  return Math.round(number * 100);
}

async function notifyMaterial(userId: number, title: string, content: string, link: string, payload: Record<string, unknown>) {
  await prisma.notification.create({
    data: { userId, category: "market", level: "normal", title, content, link, source: "靠浦特色学习资料", payload: JSON.stringify(payload) },
  }).catch(() => null);
}

function parseImagesFromDescription(content: string) {
  const urls: string[] = [];
  for (const match of content.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1]);
  }
  return urls.slice(0, 9);
}

function serializeProfile(profile: any) {
  if (!profile) return null;
  const complete = Boolean(profile.courseCode && profile.typeId && profile.applicableSemester && profile.rightsConfirmedAt);
  return {
    id: profile.id,
    courseCode: profile.courseCode || "",
    college: profile.college || "",
    major: profile.major || "",
    typeId: profile.typeId,
    type: profile.type ? {
      id: profile.type.id,
      name: profile.type.name,
      source: profile.type.source,
      status: profile.type.status,
      enabled: profile.type.enabled,
    } : null,
    applicableSemester: profile.applicableSemester || "",
    fileFormats: parseDeclaredFormats(profile.declaredFormats),
    pageCount: profile.pageCount,
    versionLabel: profile.versionLabel || "",
    language: profile.language || "",
    originalityKind: profile.originalityKind || "",
    originalityStatement: profile.originalityStatement || "",
    rightsConfirmed: Boolean(profile.rightsConfirmedAt),
    commerceMode: profile.commerceMode || "legacy_free",
    metadataComplete: complete,
    activeVersion: profile.activeVersion ? {
      id: profile.activeVersion.id,
      versionNumber: profile.activeVersion.versionNumber,
      label: profile.activeVersion.label,
      releaseNotes: profile.activeVersion.releaseNotes,
      status: profile.activeVersion.status,
      publishedAt: profile.activeVersion.publishedAt,
      review: profile.activeVersion.reviews?.[0] || null,
      files: profile.activeVersion.files || [],
    } : null,
    draftVersion: profile.versions?.[0] ? serializeVersion(profile.versions[0]) : null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function serializeVersion(version: any) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    label: version.label,
    releaseNotes: version.releaseNotes,
    status: version.status,
    publishedAt: version.publishedAt,
    review: version.reviews?.[0] || null,
    createdAt: version.createdAt,
    files: (version.files || []).map((file: any) => ({
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      format: file.format,
      pageCount: file.pageCount,
      previewEnabled: file.previewEnabled,
      previewPageStart: file.previewPageStart,
      previewPageEnd: file.previewPageEnd,
      status: file.status,
      createdAt: file.createdAt,
    })),
  };
}

export function serializeLearningMaterialItem(item: any, viewerId?: number) {
  const creatorProfile = item.seller?.learningCreatorProfile;
  const seller = item.seller ? { ...item.seller } : item.seller;
  if (seller) delete seller.learningCreatorProfile;
  return {
    id: item.id,
    topicId: item.topicId,
    sellerId: item.sellerId,
    listingType: item.listingType,
    title: item.title,
    description: item.description,
    category: item.category,
    deliveryType: "digital" as const,
    hasDigitalDelivery: Boolean(item.digitalDeliveryEncrypted || item.learningMaterial?.activeVersion),
    price: amountCentsToMoney(item.priceCents),
    priceCents: item.priceCents,
    originalPrice: item.originalPriceCents === null ? null : amountCentsToMoney(item.originalPriceCents),
    originalPriceCents: item.originalPriceCents,
    negotiable: false,
    condition: item.condition,
    tradeMode: "online" as const,
    campus: "",
    location: "",
    status: item.status,
    viewCount: item.viewCount,
    favoriteCount: item._count?.favorites ?? item.favoriteCount ?? 0,
    offerCount: item._count?.offers ?? item.offerCount ?? 0,
    images: (item.images || []).map((image: any) => ({ id: image.id, url: image.url, sort: image.sort })),
    cover: item.images?.[0]?.url || parseImagesFromDescription(item.description || "")[0] || "",
    seller: seller ? {
      ...seller,
      creatorCertified: creatorProfile?.status === "active",
      creatorCertifiedAt: creatorProfile?.certifiedAt || null,
      creatorLevel: creatorProfile?.level || "certified",
      creatorQualityScore: creatorProfile?.qualityScore ?? 60,
      creatorCompletedOrderCount: creatorProfile?.completedOrderCount ?? 0,
      creatorRatingCount: creatorProfile?.ratingCount ?? 0,
      creatorAverageRating: creatorProfile?.averageRatingBps
        ? Number((creatorProfile.averageRatingBps / 100).toFixed(2))
        : 0,
      creatorRefundRate: creatorProfile?.refundRateBps
        ? Number((creatorProfile.refundRateBps / 100).toFixed(2))
        : 0,
      creatorDisputeRate: creatorProfile?.disputeRateBps
        ? Number((creatorProfile.disputeRateBps / 100).toFixed(2))
        : 0,
      creatorAverageConfirmMinutes: creatorProfile?.averageConfirmMinutes ?? null,
    } : seller,
    topic: item.topic,
    favorited: Array.isArray(item.favorites) && item.favorites.some((favorite: any) => favorite.userId === viewerId),
    mine: Boolean(viewerId && viewerId === item.sellerId),
    material: serializeProfile(item.learningMaterial),
    soldAt: item.soldAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function ensureDefaultTypes() {
  await Promise.all(DEFAULT_LEARNING_MATERIAL_TYPES.map((name, index) => prisma.learningMaterialType.upsert({
    where: { normalizedName: normalizeMaterialTypeName(name) },
    update: { name, source: "builtin", sort: (index + 1) * 10 },
    create: { name, normalizedName: normalizeMaterialTypeName(name), source: "builtin", status: "approved", enabled: true, sort: (index + 1) * 10 },
  })));
}

async function requireVerifiedMaterialUser(userId: number, role: string) {
  if (!isFeatureOn("market")) throw Errors.forbidden("商城当前已关闭");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, studentSso: true, status: true },
  });
  if (!user) throw Errors.unauthorized();
  if (!user.studentSso && !["admin", "mod"].includes(role)) throw Errors.forbidden("仅限通过 XJTLU 统一认证的用户使用资料专区");
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
}

async function getUsableType(typeId: number | null | undefined, userId: number, allowMissing: boolean) {
  if (!typeId) {
    if (allowMissing) return null;
    throw Errors.badRequest("请选择资料类型");
  }
  const type = await prisma.learningMaterialType.findUnique({ where: { id: typeId } });
  if (!type || !type.enabled || type.status === "rejected" || type.status === "merged") throw Errors.badRequest("请选择有效的资料类型");
  if (type.status !== "approved") {
    if (allowMissing && type.status === "pending" && type.createdById === userId) return type;
    throw Errors.badRequest("该自定义资料类型仍在审核中，审核通过后才能正式发布");
  }
  return type;
}

function profileData(input: LearningMaterialProfileInput, existingRightsConfirmedAt?: Date | null) {
  return {
    courseCode: normalizeCourseCode(input.courseCode) || null,
    college: input.college || null,
    major: input.major || null,
    typeId: input.typeId || null,
    applicableSemester: input.applicableSemester || null,
    declaredFormats: JSON.stringify(normalizeDeclaredFormats(input.fileFormats)),
    pageCount: input.pageCount ?? null,
    versionLabel: input.versionLabel || null,
    language: input.language || null,
    originalityKind: input.originalityKind || null,
    originalityStatement: input.originalityStatement || null,
    rightsConfirmedAt: input.rightsConfirmed ? (existingRightsConfirmedAt || new Date()) : null,
  };
}

async function assertPublishableProfile(input: LearningMaterialProfileInput, userId: number) {
  const errors = publishedMaterialProfileErrors(input);
  if (errors.length) throw Errors.badRequest(errors[0]);
  await getUsableType(input.typeId, userId, false);
}

learningMaterialsRouter.get("/meta", async (req, res, next) => {
  try {
    await Promise.all([ensureDefaultTypes(), ensureLearningMaterialCategory()]);
    const [category, itemCount, incompleteCount, types, contentRules] = await Promise.all([
      prisma.marketCategory.findUnique({ where: { slug: CATEGORY } }),
      prisma.marketItem.count({
        where: { category: CATEGORY, status: "active", learningMaterial: { is: { commerceMode: "paid" } } },
      }),
      prisma.marketItem.count({
        where: {
          category: CATEGORY,
          status: "active",
          OR: [
            { learningMaterial: null },
            { learningMaterial: { is: { commerceMode: "legacy_free" } } },
          ],
        },
      }),
      prisma.learningMaterialType.findMany({
        where: {
          enabled: true,
          OR: [
            { status: "approved" },
            ...(req.user ? [{ createdById: req.user.userId, status: "pending" }] : []),
          ],
        },
        orderBy: [{ status: "asc" }, { sort: "asc" }, { id: "asc" }],
      }),
      prisma.marketSafetyRule.findMany({
        where: { enabled: true, scope: { in: ["learning", "all"] } },
        select: { id: true, scope: true, category: true, action: true, note: true },
        orderBy: [{ action: "asc" }, { id: "asc" }],
      }),
    ]);
    if (!category || !category.enabled) throw Errors.notFound("特色学习资料分类不存在");
    ok(res, {
      category: { ...category, itemCount },
      semesters: LEARNING_MATERIAL_SEMESTERS,
      formats: LEARNING_MATERIAL_FORMATS,
      languages: LEARNING_MATERIAL_LANGUAGES,
      originalityOptions: LEARNING_MATERIAL_ORIGINALITY,
      supportCategories: LEARNING_MATERIAL_SUPPORT_CATEGORIES,
      types,
      contentRules,
      legacyIncompleteCount: incompleteCount,
      commerce: {
        paidEnabled: PAID_LEARNING_MATERIALS_ENABLED,
        minPriceCents: LEARNING_MATERIAL_MIN_PRICE_CENTS,
        maxPriceCents: LEARNING_MATERIAL_MAX_PRICE_CENTS,
        minPrice: amountCentsToMoney(LEARNING_MATERIAL_MIN_PRICE_CENTS),
        maxPrice: amountCentsToMoney(LEARNING_MATERIAL_MAX_PRICE_CENTS),
        paymentMode: "seller_direct",
        platformFeeBps: 0,
      },
    });
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/types", async (req, res, next) => {
  try {
    await ensureDefaultTypes();
    const list = await prisma.learningMaterialType.findMany({
      where: {
        enabled: true,
        OR: [
          { status: "approved" },
          ...(req.user ? [{ createdById: req.user.userId, status: "pending" }] : []),
        ],
      },
      orderBy: [{ status: "asc" }, { sort: "asc" }, { id: "asc" }],
    });
    ok(res, list);
  } catch (error) { next(error); }
});

const customTypeSchema = z.object({ name: z.string().trim().min(1).max(30) });

learningMaterialsRouter.post("/types", authRequired, validate(customTypeSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    await requireVerifiedMaterialUser(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    await ensureDefaultTypes();
    const name = String(req.body.name || "").trim().replace(/\s+/g, " ");
    const error = validateCustomMaterialTypeName(name);
    if (error) throw Errors.badRequest(error);
    const normalizedName = normalizeMaterialTypeName(name);
    const existing = await prisma.learningMaterialType.findUnique({ where: { normalizedName } });
    if (existing) {
      if (existing.status === "approved" || existing.createdById === userId) return ok(res, existing);
      throw Errors.conflict("该资料类型已经存在或正在审核");
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.learningMaterialType.count({ where: { createdById: userId, createdAt: { gte: since } } });
    if (recentCount >= 5) throw Errors.forbidden("每天最多创建 5 个自定义资料类型");
    const created = await prisma.learningMaterialType.create({
      data: { name, normalizedName, source: "seller", status: "pending", enabled: true, createdById: userId, sort: 1000 },
    });
    ok(res, created);
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/items", async (req, res, next) => {
  try {
    if (!isFeatureOn("market")) throw Errors.forbidden("商城当前已关闭");
    await ensureLearningMaterialCategory();
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 24, 1, 60);
    const requestedStatus = String(req.query.status || "active");
    if (requestedStatus !== "active") throw Errors.badRequest("公开资料专区只能查询已发布内容；草稿和审核中内容请在“我的交易”查看");
    const q = String(req.query.q || "").trim();
    const courseCode = normalizeCourseCode(String(req.query.courseCode || ""));
    const semester = String(req.query.semester || "").trim();
    const college = String(req.query.college || "").trim();
    const major = String(req.query.major || "").trim();
    const format = String(req.query.format || "").trim().toUpperCase();
    const typeId = Number(req.query.typeId || 0);
    const where: any = {
      category: CATEGORY,
      status: "active",
    };
    const profileWhere: any = { commerceMode: "paid" };
    if (courseCode) profileWhere.courseCode = { contains: courseCode, mode: "insensitive" };
    if (semester) profileWhere.applicableSemester = semester;
    if (college) profileWhere.college = { contains: college, mode: "insensitive" };
    if (major) profileWhere.major = { contains: major, mode: "insensitive" };
    if (typeId > 0) profileWhere.typeId = typeId;
    if (format) profileWhere.declaredFormats = { contains: `"${format}"` };
    where.learningMaterial = { is: profileWhere };
    if (q) {
      where.AND = [{
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { learningMaterial: { is: { courseCode: { contains: normalizeCourseCode(q), mode: "insensitive" } } } },
          { learningMaterial: { is: { college: { contains: q, mode: "insensitive" } } } },
          { learningMaterial: { is: { major: { contains: q, mode: "insensitive" } } } },
          { learningMaterial: { is: { type: { name: { contains: q, mode: "insensitive" } } } } },
        ],
      }];
    }
    const sort = String(req.query.sort || "new");
    const orderBy: any = sort === "price_asc" ? { priceCents: "asc" }
      : sort === "price_desc" ? { priceCents: "desc" }
        : sort === "popular" ? [{ favoriteCount: "desc" }, { viewCount: "desc" }, { createdAt: "desc" }]
          : { createdAt: "desc" };
    const [list, total] = await Promise.all([
      prisma.marketItem.findMany({
        where,
        include: materialItemInclude(req.user?.userId),
        orderBy,
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.marketItem.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((item) => serializeLearningMaterialItem(item, req.user?.userId)) });
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/items/:id", async (req, res, next) => {
  try {
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("学习资料 ID 不合法");
    const item: any = await prisma.marketItem.findUnique({
      where: { id },
      include: materialItemInclude(req.user?.userId),
    });
    const isOwnerOrStaff = Boolean(item && (req.user?.userId === item.sellerId || ["admin", "mod"].includes(req.user?.role || "")));
    const historicalAccess = item && req.user?.userId && item.learningMaterial?.commerceMode === "legacy_free"
      ? await prisma.learningMaterialAccess.findFirst({
        where: { userId: req.user.userId, version: { profileId: item.learningMaterial.id }, revokedAt: null },
        select: { id: true },
      })
      : null;
    if (!item || item.category !== CATEGORY || (["draft", "reviewing", "hidden"].includes(item.status) && !isOwnerOrStaff)) {
      throw Errors.notFound("学习资料不存在");
    }
    if (item.learningMaterial?.commerceMode !== "paid" && !isOwnerOrStaff && !historicalAccess) {
      throw Errors.notFound("该历史免费资料已停止新增领取");
    }
    if (
      item.learningMaterial?.commerceMode === "paid"
      && !item.learningMaterial?.activeVersion?.reviews?.some((review: any) => review.status === "approved")
      && !isOwnerOrStaff
    ) {
      throw Errors.notFound("该资料尚未通过人工审核");
    }
    if (item.status !== "draft") prisma.marketItem.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => null);
    const rating = await prisma.marketReview.aggregate({ where: { targetUserId: item.sellerId }, _avg: { rating: true }, _count: true });
    ok(res, {
      ...serializeLearningMaterialItem(item, req.user?.userId),
      sellerRating: rating._avg.rating || 0,
      sellerReviewCount: rating._count,
    });
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/items/:id/ratings", async (req, res, next) => {
  try {
    const itemId = positiveRouteInteger(req.params.id);
    if (!itemId) throw Errors.badRequest("资料 ID 不合法");
    const item = await prisma.marketItem.findFirst({
      where: { id: itemId, category: CATEGORY, status: "active" },
      select: { id: true },
    });
    if (!item) throw Errors.notFound("学习资料不存在");
    ok(res, await listLearningMaterialRatings(itemId));
  } catch (error) { next(error); }
});

learningMaterialsRouter.post("/items/:id/purchase", authRequired, async (req, res, next) => {
  try {
    const itemId = positiveRouteInteger(req.params.id);
    if (!itemId) throw Errors.badRequest("学习资料 ID 不合法");
    const buyerId = req.user!.userId;
    await requireVerifiedMaterialUser(buyerId, req.user!.role);
    await ensureUserCanSpeak(buyerId);
    const requestedKey = normalizeIdempotencyKey(req.headers["idempotency-key"]);
    const compatKey = requestedKey || `compat-order-${buyerId}-${itemId}-${crypto.randomUUID()}`;
    ok(res, await createPaidLearningOrder(
      {
        userId: buyerId,
        role: req.user!.role,
        requestId: requestIdFromResponse(res),
      },
      itemId,
      {},
      compatKey,
    ));
  } catch (error) { next(error); }
});

learningMaterialsRouter.post("/items", authRequired, validate(materialItemInputSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    await requireVerifiedMaterialUser(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    if (!PAID_LEARNING_MATERIALS_ENABLED) throw Errors.forbidden(PAID_MATERIAL_DISABLED_MESSAGE);
    const creator = await prisma.learningCreatorProfile.findUnique({ where: { userId } });
    if (!creator || creator.status !== "active") throw Errors.forbidden("通过创作者认证后才能创建付费资料");
    await Promise.all([ensureDefaultTypes(), ensureLearningMaterialCategory()]);
    const input = req.body as z.infer<typeof materialItemInputSchema>;
    await getUsableType(input.profile.typeId, userId, input.draft);
    if (!input.draft) await assertPublishableProfile(input.profile, userId);
    if (!input.draft) throw Errors.badRequest("请先保存草稿并上传资料文件，再正式发布");
    const category = await prisma.marketCategory.findUnique({ where: { slug: CATEGORY } });
    if (!category?.enabled) throw Errors.badRequest("特色学习资料专区当前不可发布");
    const amount = priceCents(input.price) ?? 0;
    if (!isAllowedLearningMaterialPrice(amount)) {
      throw Errors.badRequest(
        `资料售价必须在 ${amountCentsToMoney(LEARNING_MATERIAL_MIN_PRICE_CENTS)} 至 ${amountCentsToMoney(LEARNING_MATERIAL_MAX_PRICE_CENTS)} 元之间`,
      );
    }
    const originalAmount = priceCents(input.originalPrice);
    const contentSafety = await evaluateMarketContent(prisma, [
      input.title,
      input.description,
      input.profile.originalityStatement,
    ], "learning");
    if (contentSafety.action === "block") {
      throw Errors.badRequest(contentSafety.matches[0]?.note || "该资料不符合付费学习资料内容规则");
    }
    const metadata = {
      marketItem: true,
      learningMaterial: true,
      category: CATEGORY,
      deliveryType: "digital",
      tradeMode: "online",
      listingType: "sell",
      price: Number(amountCentsToMoney(amount)),
      images: input.images,
      courseCode: normalizeCourseCode(input.profile.courseCode),
      applicableSemester: input.profile.applicableSemester || "",
      materialTypeId: input.profile.typeId || null,
    };
    const bypass = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const review = shouldRunAiReview() && !bypass
      ? await reviewTopicContent({ title: input.title, content: input.description, boardName: "靠浦特色学习资料", boardType: "market", metadata })
      : null;
    const hiddenByReview = review?.status === "blocked_ai";
    const item = await prisma.marketItem.create({
      data: {
        sellerId: userId,
        listingType: "sell",
        title: input.title,
        description: input.description,
        category: CATEGORY,
        deliveryType: "digital",
        priceCents: amount,
        originalPriceCents: originalAmount,
        negotiable: false,
        condition: "good",
        tradeMode: "online",
        campus: "",
        location: "",
        status: input.draft ? "draft" : hiddenByReview ? "reviewing" : "active",
        moderationNote: contentSafety.action === "review"
          ? (contentSafety.matches[0]?.note || "内容需要人工复核")
          : hiddenByReview ? review?.reason || "AI 内容复核未通过" : "",
        images: { create: input.images.map((url, sort) => ({ url, sort })) },
        learningMaterial: { create: { ...profileData(input.profile), commerceMode: "paid" } },
      },
      include: materialItemInclude(userId),
    });
    ok(res, { ...serializeLearningMaterialItem(item, userId), review: review ? { status: review.status, reason: review.reason } : null });
  } catch (error) { next(error); }
});

learningMaterialsRouter.patch("/items/:id", authRequired, validate(materialItemPatchSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user!.userId;
    const current = await prisma.marketItem.findUnique({
      where: { id },
      include: { images: true, learningMaterial: { include: { activeVersion: true } } },
    });
    if (!current || current.category !== CATEGORY) throw Errors.notFound("学习资料不存在");
    if (current.sellerId !== userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden("无权修改该资料");
    if (!PAID_LEARNING_MATERIALS_ENABLED) throw Errors.forbidden(PAID_MATERIAL_DISABLED_MESSAGE);
    if (!["admin", "mod"].includes(req.user!.role)) {
      const creator = await prisma.learningCreatorProfile.findUnique({ where: { userId } });
      if (!creator || creator.status !== "active") throw Errors.forbidden("通过创作者认证后才能维护付费资料");
    }
    const input = req.body as z.infer<typeof materialItemPatchSchema>;
    const requestedPrice = input.price === undefined ? current.priceCents : (priceCents(input.price) ?? 0);
    if (!isAllowedLearningMaterialPrice(requestedPrice)) {
      throw Errors.badRequest(
        `资料售价必须在 ${amountCentsToMoney(LEARNING_MATERIAL_MIN_PRICE_CENTS)} 至 ${amountCentsToMoney(LEARNING_MATERIAL_MAX_PRICE_CENTS)} 元之间`,
      );
    }
    if (input.status && !["admin", "mod"].includes(req.user!.role) && !["withdrawn", "draft"].includes(input.status)) {
      throw Errors.forbidden("不能切换到该资料状态");
    }
    if (!["admin", "mod"].includes(req.user!.role) && (input.status === "active" || input.draft === false)) {
      throw Errors.badRequest("付费资料必须提交版本审核，不能直接公开发布");
    }
    const isPublishing = ["admin", "mod"].includes(req.user!.role) && input.status === "active";
    const nextProfile: LearningMaterialProfileInput = input.profile || {
      courseCode: current.learningMaterial?.courseCode || "",
      college: current.learningMaterial?.college || "",
      major: current.learningMaterial?.major || "",
      typeId: current.learningMaterial?.typeId || null,
      applicableSemester: current.learningMaterial?.applicableSemester as any,
      fileFormats: parseDeclaredFormats(current.learningMaterial?.declaredFormats),
      pageCount: current.learningMaterial?.pageCount || null,
      versionLabel: current.learningMaterial?.versionLabel || "",
      language: current.learningMaterial?.language || "",
      originalityKind: current.learningMaterial?.originalityKind || "",
      originalityStatement: current.learningMaterial?.originalityStatement || "",
      rightsConfirmed: Boolean(current.learningMaterial?.rightsConfirmedAt),
    };
    await getUsableType(nextProfile.typeId, userId, !isPublishing);
    if (isPublishing) await assertPublishableProfile(nextProfile, userId);
    if (isPublishing && !current.learningMaterial?.activeVersion && !current.digitalDeliveryEncrypted) {
      throw Errors.badRequest("正式发布前请先上传并发布至少一个资料文件版本");
    }
    const nextTitle = input.title === undefined ? current.title : input.title;
    const nextDescription = input.description === undefined ? current.description : input.description;
    const contentSafety = await evaluateMarketContent(prisma, [
      nextTitle,
      nextDescription,
      nextProfile.originalityStatement,
    ], "learning");
    if (contentSafety.action === "block") {
      throw Errors.badRequest(contentSafety.matches[0]?.note || "该资料不符合付费学习资料内容规则");
    }
    const requiresRuleReview = contentSafety.action === "review" && (isPublishing || current.status === "active");
    const updated = await prisma.$transaction(async (tx) => {
      if (input.images) {
        await tx.marketImage.deleteMany({ where: { itemId: id } });
        if (input.images.length) await tx.marketImage.createMany({ data: input.images.map((url, sort) => ({ itemId: id, url, sort })) });
      }
      const itemData: any = {
        title: input.title,
        description: input.description,
        priceCents: input.price === undefined ? undefined : priceCents(input.price),
        originalPriceCents: input.originalPrice === undefined ? undefined : priceCents(input.originalPrice),
        status: requiresRuleReview
          ? "reviewing"
          : input.status
            || (input.draft === undefined ? (current.status === "active" ? "draft" : undefined) : "draft"),
        moderationNote: requiresRuleReview ? (contentSafety.matches[0]?.note || "内容需要人工复核") : undefined,
      };
      if (input.profile) {
        await tx.learningMaterialProfile.upsert({
          where: { itemId: id },
          update: { ...profileData(nextProfile, current.learningMaterial?.rightsConfirmedAt), commerceMode: "paid" },
          create: { itemId: id, ...profileData(nextProfile), commerceMode: "paid" },
        });
      }
      return tx.marketItem.update({ where: { id }, data: itemData, include: materialItemInclude(userId) });
    });
    ok(res, serializeLearningMaterialItem(updated, userId));
  } catch (error) { next(error); }
});

function parseMaterialFiles(req: any, res: any, next: any) {
  materialFileUpload.array("files", 10)(req, res, (error: any) => {
    if (!error) {
      normalizeMulterOriginalNames((req.files || []) as Express.Multer.File[]);
      return next();
    }
    if (error?.code === "LIMIT_FILE_SIZE") return next(Errors.badRequest("单个资料文件不能超过 100MB"));
    if (error?.code === "LIMIT_FILE_COUNT") return next(Errors.badRequest("每个版本最多上传 10 个文件"));
    return next(error);
  });
}

type UploadedPreviewRange = { start: number; end: number } | null;

function parseUploadedPreviewRanges(value: unknown, fileCount: number): UploadedPreviewRange[] {
  if (!value) return Array.from({ length: fileCount }, () => null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw Errors.badRequest("PDF 试读页配置格式无效");
  }
  if (!Array.isArray(parsed) || parsed.length !== fileCount) {
    throw Errors.badRequest("PDF 试读页配置必须与上传文件一一对应");
  }
  return parsed.map((entry) => {
    if (entry === null) return null;
    const start = Number((entry as any)?.start);
    const end = Number((entry as any)?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw Errors.badRequest("PDF 试读起止页必须为整数");
    }
    return { start, end };
  });
}

learningMaterialsRouter.post("/items/:id/versions", authRequired, parseMaterialFiles, async (req, res, next) => {
  const uploadedFiles = (req.files || []) as Express.Multer.File[];
  const movedPaths: string[] = [];
  try {
    const id = Number(req.params.id);
    const item = await prisma.marketItem.findUnique({ where: { id }, include: { learningMaterial: true } });
    if (!item || item.category !== CATEGORY || !item.learningMaterial) throw Errors.notFound("学习资料不存在");
    if (item.sellerId !== req.user!.userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden("无权上传该资料的文件");
    if (!uploadedFiles.length) throw Errors.badRequest("请选择至少一个资料文件");
    for (const file of uploadedFiles) {
      if (!isAllowedLearningMaterialFile(file.originalname)) throw Errors.badRequest(`不支持的文件格式：${file.originalname}`);
    }
    const previewRanges = parseUploadedPreviewRanges(req.body.previewRanges, uploadedFiles.length);
    const latest = await prisma.learningMaterialVersion.aggregate({ where: { profileId: item.learningMaterial.id }, _max: { versionNumber: true } });
    const versionNumber = (latest._max.versionNumber || 0) + 1;
    const relativeDir = path.posix.join(String(item.learningMaterial.id), String(versionNumber));
    const absoluteDir = path.resolve(PRIVATE_MATERIAL_ROOT, relativeDir);
    await mkdir(absoluteDir, { recursive: true });
    const prepared: Array<{
      originalName: string;
      storedName: string;
      relativePath: string;
      mimeType: string;
      fileSize: number;
      format: string;
      pageCount: number | null;
      previewEnabled: boolean;
      previewPageStart: number | null;
      previewPageEnd: number | null;
      sha256: string;
    }> = [];
    for (const [fileIndex, file] of uploadedFiles.entries()) {
      const extension = path.extname(file.originalname).toLowerCase();
      const storedName = `${crypto.randomUUID()}${extension}`;
      const absolutePath = path.join(absoluteDir, storedName);
      await rename(file.path, absolutePath);
      movedPaths.push(absolutePath);
      const buffer = await readFile(absolutePath);
      const format = learningMaterialFileFormat(file.originalname);
      const previewRange = previewRanges[fileIndex];
      let pageCount: number | null = null;
      if (format === "PDF") {
        pageCount = (await inspectLearningPdf(buffer)).pageCount;
        if (previewRange) validateLearningPdfPreviewRange(pageCount, previewRange.start, previewRange.end);
      } else if (previewRange) {
        throw Errors.badRequest("当前仅支持为 PDF 配置真实试读页");
      }
      prepared.push({
        originalName: file.originalname,
        storedName,
        relativePath: path.posix.join(relativeDir, storedName),
        mimeType: file.mimetype || "application/octet-stream",
        fileSize: file.size,
        format,
        pageCount,
        previewEnabled: Boolean(previewRange),
        previewPageStart: previewRange?.start ?? null,
        previewPageEnd: previewRange?.end ?? null,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      });
    }
    const label = String(req.body.label || "").trim().slice(0, 80);
    const releaseNotes = String(req.body.releaseNotes || "").trim().slice(0, 1000);
    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.learningMaterialVersion.create({
        data: {
          profileId: item.learningMaterial!.id,
          versionNumber,
          label,
          releaseNotes,
          status: "draft",
          createdById: req.user!.userId,
          files: { create: prepared },
        },
        include: { files: { select: safeFileSelect, orderBy: { id: "asc" } } },
      });
      const existingFormats = parseDeclaredFormats(item.learningMaterial!.declaredFormats);
      const actualFormats = prepared.map((file) => file.format);
      await tx.learningMaterialProfile.update({
        where: { id: item.learningMaterial!.id },
        data: {
          declaredFormats: JSON.stringify(Array.from(new Set([...existingFormats, ...actualFormats]))),
          pageCount: prepared
            .filter((file) => file.format === "PDF")
            .reduce((total, file) => total + (file.pageCount || 0), 0) || item.learningMaterial!.pageCount,
        },
      });
      return created;
    });
    ok(res, serializeVersion(version));
  } catch (error) {
    await Promise.all([
      ...uploadedFiles.map((file) => rm(file.path, { force: true }).catch(() => null)),
      ...movedPaths.map((file) => rm(file, { force: true }).catch(() => null)),
    ]);
    next(error);
  }
});

learningMaterialsRouter.post("/items/:itemId/versions/:versionId/publish", authRequired, async (req, res, next) => {
  try {
    const itemId = positiveRouteInteger(req.params.itemId);
    const versionId = positiveRouteInteger(req.params.versionId);
    if (!itemId || !versionId) throw Errors.badRequest("资料或版本 ID 不合法");
    ok(res, await submitMaterialVersionReview(
      {
        userId: req.user!.userId,
        role: req.user!.role,
        requestId: requestIdFromResponse(res),
      },
      itemId,
      versionId,
    ));
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/library", authRequired, async (req, res, next) => {
  try {
    const accesses = await prisma.learningMaterialAccess.findMany({
      where: { userId: req.user!.userId, revokedAt: null },
      include: {
        order: {
          include: {
            learningCommerceOrder: { select: { id: true, mode: true, status: true } },
            item: { include: { seller: { select: MARKET_PUBLIC_USER_SELECT }, images: { orderBy: { sort: "asc" } } } },
          },
        },
        version: {
          include: {
            files: { where: { status: "active" }, select: safeFileSelect, orderBy: { id: "asc" } },
            profile: { include: { type: true, item: { include: { seller: { select: MARKET_PUBLIC_USER_SELECT }, images: { orderBy: { sort: "asc" } }, topic: true, _count: { select: { favorites: true, offers: true } } } } } },
          },
        },
      },
      orderBy: { grantedAt: "desc" },
    });
    ok(res, accesses.map((access: any) => ({
      id: access.id,
      grantedAt: access.grantedAt,
      lastAccessedAt: access.lastAccessedAt,
      downloadCount: access.downloadCount,
      order: {
        ...access.order,
        amount: amountCentsToMoney(access.order.amountCents),
        platformFee: amountCentsToMoney(access.order.platformFeeCents),
        sellerAmount: amountCentsToMoney(access.order.sellerAmountCents),
      },
      version: {
        ...serializeVersion(access.version),
        profile: {
          ...serializeProfile({ ...access.version.profile, activeVersion: null }),
          item: serializeLearningMaterialItem({ ...access.version.profile.item, learningMaterial: access.version.profile }, req.user!.userId),
        },
      },
    })));
  } catch (error) { next(error); }
});

function resolvePrivateMaterialPath(relativePath: string) {
  const absolutePath = path.resolve(PRIVATE_MATERIAL_ROOT, relativePath);
  const rootPrefix = `${PRIVATE_MATERIAL_ROOT}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix)) throw Errors.forbidden("资料文件路径无效");
  return absolutePath;
}

learningMaterialsRouter.get("/items/:itemId/files/:fileId/sample", async (req, res, next) => {
  try {
    const itemId = positiveRouteInteger(req.params.itemId);
    const fileId = positiveRouteInteger(req.params.fileId);
    if (!itemId || !fileId) throw Errors.badRequest("资料或文件 ID 不合法");
    const file = await prisma.learningMaterialFile.findUnique({
      where: { id: fileId },
      include: { version: { include: { profile: { include: { item: true } } } } },
    });
    if (
      !file
      || file.status !== "active"
      || file.format !== "PDF"
      || !file.previewEnabled
      || !file.previewPageStart
      || !file.previewPageEnd
      || file.version.profile.itemId !== itemId
      || file.version.profile.activeVersionId !== file.versionId
      || file.version.profile.item.status !== "active"
    ) {
      throw Errors.notFound("该资料暂未开放真实试读");
    }
    const absolutePath = resolvePrivateMaterialPath(file.relativePath);
    const source = await readFile(absolutePath).catch(() => {
      throw Errors.notFound("资料试读文件已丢失，请联系平台");
    });
    const sample = await createLearningPdfSample(source, file.previewPageStart, file.previewPageEnd);
    await prisma.learningMaterialAccessEvent.create({
      data: {
        fileId,
        itemId,
        userId: req.user?.userId || null,
        action: "sample_preview",
        bytes: sample.length,
        ipHash: hashLearningAccessValue(req.ip || "", config.jwtSecret),
        clientHash: hashLearningAccessValue(String(req.headers["user-agent"] || ""), config.jwtSecret),
      },
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(`sample-${file.originalName}`)}`);
    res.send(sample);
  } catch (error) { next(error); }
});

async function serveAuthorizedMaterialFile(req: any, res: any, next: any, action: "online_preview" | "download") {
  try {
    const fileId = positiveRouteInteger(req.params.fileId);
    if (!fileId) throw Errors.badRequest("文件 ID 不合法");
    const file = await prisma.learningMaterialFile.findUnique({
      where: { id: fileId },
      include: { version: { include: { profile: { include: { item: true } } } } },
    });
    if (!file || file.status !== "active") throw Errors.notFound("资料文件不存在");
    const isOwner = file.version.profile.item.sellerId === req.user!.userId;
    const isStaff = ["admin", "mod"].includes(req.user!.role);
    const access = isOwner || isStaff ? null : await prisma.learningMaterialAccess.findFirst({
      where: { userId: req.user!.userId, versionId: file.versionId, revokedAt: null, order: { status: { in: ["paid", "delivering", "completed", "refund_pending", "disputed"] } } },
    });
    if (!isOwner && !isStaff && !access) throw Errors.forbidden("购买并完成付款后才能访问该资料");
    if (action === "online_preview" && file.format !== "PDF") {
      throw Errors.badRequest("当前仅支持 PDF 在线阅读，其他格式请下载后查看");
    }
    const absolutePath = resolvePrivateMaterialPath(file.relativePath);
    await stat(absolutePath).catch(() => { throw Errors.notFound("资料文件已丢失，请联系平台售后"); });
    const accessedAt = new Date();
    const watermarkCode = access && file.format === "PDF" ? newLearningWatermarkCode() : "";
    let payload: Buffer | null = null;
    if (access && file.format === "PDF") {
      const source = await readFile(absolutePath);
      payload = await createLicensedLearningPdf(source, {
        userId: req.user!.userId,
        orderId: access.orderId,
        fileId,
        accessedAt,
        watermarkCode,
      });
    }
    await prisma.$transaction(async (tx) => {
      if (access) {
        await tx.learningMaterialAccess.update({
          where: { id: access.id },
          data: {
            downloadCount: action === "download" ? { increment: 1 } : undefined,
            lastAccessedAt: accessedAt,
          },
        });
      }
      await tx.learningMaterialAccessEvent.create({
        data: {
          accessId: access?.id || null,
          fileId,
          userId: req.user!.userId,
          orderId: access?.orderId || null,
          itemId: file.version.profile.itemId,
          action,
          watermarkCode,
          bytes: payload?.length ?? file.fileSize,
          ipHash: hashLearningAccessValue(req.ip || "", config.jwtSecret),
          clientHash: hashLearningAccessValue(String(req.headers["user-agent"] || ""), config.jwtSecret),
        },
      });
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (payload) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${action === "online_preview" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      res.send(payload);
      return;
    }
    if (action === "online_preview") {
      res.setHeader("Content-Type", file.mimeType || "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
      res.sendFile(absolutePath);
      return;
    }
    res.download(absolutePath, file.originalName);
  } catch (error) { next(error); }
}

learningMaterialsRouter.get("/files/:fileId/view", authRequired, (req, res, next) => {
  void serveAuthorizedMaterialFile(req, res, next, "online_preview");
});

learningMaterialsRouter.get("/files/:fileId/download", authRequired, (req, res, next) => {
  void serveAuthorizedMaterialFile(req, res, next, "download");
});

const supportCreateSchema = z.object({
  category: z.string().trim().min(1).max(40),
  message: z.string().trim().min(2).max(2000),
});

const supportMessageSchema = z.object({ content: z.string().trim().min(1).max(2000) });
const supportActionSchema = z.object({ action: z.enum(["resolve", "reopen", "escalate"]) });

function supportInclude() {
  return {
    buyer: { select: MARKET_PUBLIC_USER_SELECT },
    seller: { select: MARKET_PUBLIC_USER_SELECT },
    order: { include: { item: { include: { images: { orderBy: { sort: "asc" as const }, take: 1 }, learningMaterial: { include: { type: true } } } } } },
    messages: { include: { sender: { select: MARKET_PUBLIC_USER_SELECT } }, orderBy: { createdAt: "asc" as const }, take: 300 },
  } as const;
}

function serializeSupportTicket(ticket: any) {
  return {
    ...ticket,
    order: ticket.order ? {
      ...ticket.order,
      amount: amountCentsToMoney(ticket.order.amountCents),
      platformFee: amountCentsToMoney(ticket.order.platformFeeCents),
      sellerAmount: amountCentsToMoney(ticket.order.sellerAmountCents),
      item: ticket.order.item ? {
        ...ticket.order.item,
        cover: ticket.order.item.images?.[0]?.url || "",
        material: ticket.order.item.learningMaterial ? serializeProfile(ticket.order.item.learningMaterial) : null,
      } : undefined,
    } : undefined,
  };
}

learningMaterialsRouter.post("/orders/:orderId/support", authRequired, validate(supportCreateSchema), async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    const buyerId = req.user!.userId;
    const category = String(req.body.category);
    if (!LEARNING_MATERIAL_SUPPORT_CATEGORIES.some((item) => item.value === category)) throw Errors.badRequest("请选择有效的问题类型");
    if (containsOffPlatformContact(req.body.message)) throw Errors.badRequest("售后沟通不能发送联系方式、外部链接或私下付款信息");
    const order = await prisma.marketOrder.findUnique({ where: { id: orderId }, include: { item: true } });
    if (!order || order.item.category !== CATEGORY || order.deliveryType !== "digital") throw Errors.notFound("学习资料订单不存在");
    if (order.buyerId !== buyerId) throw Errors.forbidden("只有买家可以发起订单售后");
    if (!["paid", "delivering", "completed", "refund_pending", "disputed"].includes(order.status)) throw Errors.badRequest("当前订单还不能发起售后");
    if (supportCategoryIsFinancial(category) && category !== "copyright" && order.paidAt && Date.now() - order.paidAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
      throw Errors.badRequest("该订单已超过7天售后申请期，可继续使用普通咨询或版权举报");
    }
    const existing = await prisma.learningMaterialSupportTicket.findUnique({ where: { orderId } });
    const ticket = await prisma.$transaction(async (tx) => {
      let nextTicket = existing;
      if (!nextTicket) {
        nextTicket = await tx.learningMaterialSupportTicket.create({
          data: { orderId, buyerId: order.buyerId, sellerId: order.sellerId, category, status: "waiting_seller", responseDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
        });
      } else {
        nextTicket = await tx.learningMaterialSupportTicket.update({
          where: { id: nextTicket.id },
          data: { category, status: "waiting_seller", responseDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), resolvedAt: null },
        });
      }
      await tx.learningMaterialSupportMessage.create({ data: { ticketId: nextTicket.id, senderId: buyerId, content: req.body.message } });
      if (supportCategoryIsFinancial(category)) {
        await tx.marketSettlement.updateMany({ where: { orderId, status: { in: ["pending", "available"] } }, data: { status: "held", note: "学习资料售后处理中" } });
      }
      return nextTicket;
    });
    await notifyMaterial(order.sellerId, "收到资料售后问题", `买家就「${order.item.title}」发起了售后沟通`, `/market/learning-materials/support?ticket=${ticket.id}`, { type: "learning-material-support", ticketId: ticket.id, orderId });
    const complete = await prisma.learningMaterialSupportTicket.findUnique({ where: { id: ticket.id }, include: supportInclude() });
    ok(res, serializeSupportTicket(complete));
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/support", authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const staff = ["admin", "mod"].includes(req.user!.role);
    const list = await prisma.learningMaterialSupportTicket.findMany({
      where: staff ? {} : { OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: supportInclude(),
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    ok(res, list.map(serializeSupportTicket));
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/support/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ticket = await prisma.learningMaterialSupportTicket.findUnique({ where: { id }, include: supportInclude() });
    if (!ticket || (!["admin", "mod"].includes(req.user!.role) && ticket.buyerId !== req.user!.userId && ticket.sellerId !== req.user!.userId)) throw Errors.notFound("售后服务单不存在");
    ok(res, serializeSupportTicket(ticket));
  } catch (error) { next(error); }
});

learningMaterialsRouter.post("/support/:id/messages", authRequired, validate(supportMessageSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user!.userId;
    if (containsOffPlatformContact(req.body.content)) throw Errors.badRequest("售后沟通不能发送联系方式、外部链接或私下付款信息");
    const ticket = await prisma.learningMaterialSupportTicket.findUnique({ where: { id }, include: { order: { include: { item: true } } } });
    if (!ticket || (!["admin", "mod"].includes(req.user!.role) && ticket.buyerId !== userId && ticket.sellerId !== userId)) throw Errors.notFound("售后服务单不存在");
    if (["closed"].includes(ticket.status)) throw Errors.badRequest("该售后服务单已经关闭");
    const isBuyer = ticket.buyerId === userId;
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.learningMaterialSupportMessage.create({ data: { ticketId: id, senderId: userId, content: req.body.content }, include: { sender: { select: MARKET_PUBLIC_USER_SELECT } } });
      await tx.learningMaterialSupportTicket.update({
        where: { id },
        data: { status: isBuyer ? "waiting_seller" : "waiting_buyer", responseDueAt: isBuyer ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null },
      });
      return created;
    });
    const recipientId = isBuyer ? ticket.sellerId : ticket.buyerId;
    await notifyMaterial(recipientId, "资料售后有新回复", `「${ticket.order.item.title}」的售后服务单收到新消息`, `/market/learning-materials/support?ticket=${id}`, { type: "learning-material-support-message", ticketId: id });
    ok(res, message);
  } catch (error) { next(error); }
});

learningMaterialsRouter.patch("/support/:id", authRequired, validate(supportActionSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user!.userId;
    const ticket = await prisma.learningMaterialSupportTicket.findUnique({ where: { id }, include: { order: { include: { item: true } } } });
    if (!ticket || (!["admin", "mod"].includes(req.user!.role) && ticket.buyerId !== userId && ticket.sellerId !== userId)) throw Errors.notFound("售后服务单不存在");
    const action = req.body.action as "resolve" | "reopen" | "escalate";
    const staff = ["admin", "mod"].includes(req.user!.role);
    if (action === "reopen" && ticket.buyerId !== userId) throw Errors.forbidden("只有买家可以重新开启售后");
    if (action === "escalate" && ticket.buyerId !== userId && !["admin", "mod"].includes(req.user!.role)) throw Errors.forbidden("只有买家可以申请平台介入");
    const updated = await prisma.$transaction(async (tx) => {
      await acquireMarketOrderLock(tx, ticket.orderId);
      const lockedOrder = await tx.marketOrder.findUnique({ where: { id: ticket.orderId } });
      if (!lockedOrder) throw Errors.notFound("关联订单不存在");
      if (action === "resolve") {
        if (!staff && ticket.sellerId === userId) {
          const waiting = await tx.learningMaterialSupportTicket.update({ where: { id }, data: { status: "waiting_buyer", responseDueAt: null } });
          await tx.learningMaterialSupportMessage.create({ data: { ticketId: id, kind: "system", content: "卖家已提交处理结果，等待买家确认问题是否解决" } });
          return waiting;
        }
        const resolved = await tx.learningMaterialSupportTicket.update({ where: { id }, data: { status: "resolved", resolvedAt: new Date(), responseDueAt: null } });
        await tx.learningMaterialSupportMessage.create({ data: { ticketId: id, kind: "system", content: "服务单已标记为问题解决" } });
        if (lockedOrder.status === "disputed") {
          await tx.marketOrder.update({ where: { id: ticket.orderId }, data: { status: lockedOrder.completedAt ? "completed" : "paid" } });
        }
        await tx.marketSettlement.updateMany({
          where: { orderId: ticket.orderId, status: "held", note: { in: ["学习资料售后处理中", "平台介入资料售后"] } },
          data: lockedOrder.completedAt ? { status: "available", availableAt: new Date(), note: "学习资料售后已解决" } : { status: "pending", note: "学习资料售后已解决，等待订单完成" },
        });
        return resolved;
      }
      if (action === "reopen") {
        const reopened = await tx.learningMaterialSupportTicket.update({ where: { id }, data: { status: "waiting_seller", resolvedAt: null, responseDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
        await tx.learningMaterialSupportMessage.create({ data: { ticketId: id, kind: "system", content: "买家重新开启了售后服务单" } });
        if (supportCategoryIsFinancial(ticket.category)) await tx.marketSettlement.updateMany({ where: { orderId: ticket.orderId, status: { in: ["pending", "available"] } }, data: { status: "held", note: "学习资料售后处理中" } });
        return reopened;
      }
      const escalated = await tx.learningMaterialSupportTicket.update({ where: { id }, data: { status: "escalated", responseDueAt: null } });
      await tx.learningMaterialSupportMessage.create({ data: { ticketId: id, kind: "system", content: "买家已申请平台介入，相关订单和资料版本记录将作为处理依据" } });
      if (!["refunded", "refund_pending"].includes(lockedOrder.status)) await tx.marketOrder.update({ where: { id: ticket.orderId }, data: { status: "disputed" } });
      await tx.marketSettlement.updateMany({ where: { orderId: ticket.orderId, status: { not: "settled" } }, data: { status: "held", note: "平台介入资料售后" } });
      return escalated;
    });
    if (action === "escalate") {
      const recipients = await prisma.user.findMany({ where: { role: { in: ["admin", "mod"] } }, select: { id: true } });
      if (recipients.length) await prisma.notification.createMany({ data: recipients.map((user) => ({ userId: user.id, category: "market", level: "strong", title: "学习资料售后需要平台介入", content: `订单 ${ticket.order.outTradeNo} 已升级为争议`, link: `/market/learning-materials/support?ticket=${id}`, source: "靠浦特色学习资料", payload: JSON.stringify({ type: "learning-material-support-escalated", ticketId: id, orderId: ticket.orderId }) })) });
    }
    const complete = await prisma.learningMaterialSupportTicket.findUnique({ where: { id: updated.id }, include: supportInclude() });
    ok(res, serializeSupportTicket(complete));
  } catch (error) { next(error); }
});

const typeAdminSchema = z.object({
  action: z.enum(["approve", "reject", "enable", "disable", "merge"]),
  targetTypeId: z.coerce.number().int().positive().optional(),
});

function serializeAdminMaterialType(type: any) {
  return { ...type, _count: { profiles: type._count?.materials || 0 } };
}

learningMaterialsRouter.get("/admin/overview", authRequired, materialStaffRequired, async (_req, res, next) => {
  try {
    const [activeItems, draftItems, incompleteProfiles, activeVersions, files, pendingTypes, escalatedTickets] = await Promise.all([
      prisma.marketItem.count({ where: { category: CATEGORY, status: "active" } }),
      prisma.marketItem.count({ where: { category: CATEGORY, status: { in: ["draft", "reviewing"] } } }),
      prisma.learningMaterialProfile.count({ where: { OR: [{ courseCode: null }, { courseCode: "" }, { applicableSemester: null }, { applicableSemester: "" }, { typeId: null }, { rightsConfirmedAt: null }, { activeVersionId: null }] } }),
      prisma.learningMaterialVersion.count({ where: { status: "active" } }),
      prisma.learningMaterialFile.count({ where: { status: "active" } }),
      prisma.learningMaterialType.count({ where: { status: "pending" } }),
      prisma.learningMaterialSupportTicket.count({ where: { status: "escalated" } }),
    ]);
    ok(res, { activeItems, draftItems, incompleteProfiles, activeVersions, files, pendingTypes, escalatedTickets });
  } catch (error) { next(error); }
});

learningMaterialsRouter.get("/admin/types", authRequired, materialStaffRequired, async (_req, res, next) => {
  try {
    const list = await prisma.learningMaterialType.findMany({
      include: { createdBy: { select: MARKET_PUBLIC_USER_SELECT }, mergedInto: true, _count: { select: { materials: true } } },
      orderBy: [{ status: "desc" }, { sort: "asc" }, { createdAt: "desc" }],
    });
    ok(res, list.map(serializeAdminMaterialType));
  } catch (error) { next(error); }
});

learningMaterialsRouter.patch("/admin/types/:id", authRequired, materialStaffRequired, validate(typeAdminSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const action = req.body.action as "approve" | "reject" | "enable" | "disable" | "merge";
    const current = await prisma.learningMaterialType.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("资料类型不存在");
    if (action === "merge") {
      const targetTypeId = Number(req.body.targetTypeId || 0);
      if (!targetTypeId || targetTypeId === id) throw Errors.badRequest("请选择另一个已通过的资料类型作为合并目标");
      const target = await prisma.learningMaterialType.findFirst({ where: { id: targetTypeId, status: "approved", enabled: true } });
      if (!target) throw Errors.badRequest("合并目标不存在或当前不可用");
      await prisma.$transaction(async (tx) => {
        await tx.learningMaterialProfile.updateMany({ where: { typeId: id }, data: { typeId: target.id } });
        await tx.learningMaterialType.update({ where: { id }, data: { status: "merged", enabled: false, mergedIntoId: target.id } });
      });
    } else if (action === "approve") {
      await prisma.learningMaterialType.update({ where: { id }, data: { status: "approved", enabled: true, mergedIntoId: null } });
    } else if (action === "reject") {
      await prisma.learningMaterialType.update({ where: { id }, data: { status: "rejected", enabled: false } });
    } else if (action === "disable") {
      const activeUsage = await prisma.learningMaterialProfile.count({ where: { typeId: id, item: { status: "active" } } });
      if (activeUsage) throw Errors.badRequest(`该类型仍有 ${activeUsage} 份在售资料，请先合并类型或下架资料`);
      await prisma.learningMaterialType.update({ where: { id }, data: { enabled: false } });
    } else {
      if (current.status !== "approved") throw Errors.badRequest("只有审核通过的资料类型可以重新启用");
      await prisma.learningMaterialType.update({ where: { id }, data: { enabled: true } });
    }
    const updated = await prisma.learningMaterialType.findUnique({ where: { id }, include: { createdBy: { select: MARKET_PUBLIC_USER_SELECT }, mergedInto: true, _count: { select: { materials: true } } } });
    ok(res, serializeAdminMaterialType(updated));
  } catch (error) { next(error); }
});
