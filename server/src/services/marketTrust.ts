import crypto from "node:crypto";
import { config } from "../config";
import { Errors } from "../utils/response";
import { transactionPointLevel } from "./transactionPoints";

export type MarketContentDecision = "allow" | "review" | "block";
export type MarketAccessAction = "publish" | "trade";
export type ContentSafetyScope = "market" | "forum" | "learning";

function normalizeContent(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

export async function evaluateMarketContent(
  prisma: any,
  fields: Array<string | null | undefined>,
  scope: ContentSafetyScope = "market",
) {
  const content = normalizeContent(fields.filter(Boolean).join("\n"));
  if (!content) return { action: "allow" as MarketContentDecision, matches: [] as any[] };
  const rules = await prisma.marketSafetyRule.findMany({
    where: { enabled: true, scope: { in: [scope, "all"] } },
    select: { id: true, keyword: true, scope: true, category: true, action: true, note: true },
    orderBy: [{ action: "asc" }, { id: "asc" }],
  });
  const matches = rules.filter((rule: any) => content.includes(normalizeContent(rule.keyword)));
  const action: MarketContentDecision = matches.some((rule: any) => rule.action === "block")
    ? "block"
    : matches.some((rule: any) => rule.action === "review")
      ? "review"
      : "allow";
  return { action, matches };
}

export async function expireMarketViolations(prisma: any, now = new Date()) {
  return prisma.marketViolation.updateMany({
    where: { status: "active", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
}

export async function ensureMarketAccess(prisma: any, userId: number, action: MarketAccessAction, role = "user") {
  if (["admin", "mod"].includes(role)) return;
  const now = new Date();
  await expireMarketViolations(prisma, now);
  const restrictedActions = action === "publish" ? ["restrict_publish", "restrict_trade"] : ["restrict_trade"];
  const violation = await prisma.marketViolation.findFirst({
    where: {
      userId,
      status: "active",
      action: { in: restrictedActions },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, reason: true, expiresAt: true },
  });
  if (!violation) return;
  const until = violation.expiresAt ? `，限制至 ${violation.expiresAt.toLocaleString("zh-CN")}` : "";
  throw Errors.forbidden(`该账号的市集${action === "publish" ? "发布" : "交易"}功能已受限${until}：${violation.reason}`);
}

function contactKey() {
  return crypto.createHash("sha256").update(`xjtlu-market-contact:${config.jwtSecret}`).digest();
}

export function sealMarketContact(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", contactKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openMarketContact(value: string) {
  const payload = Buffer.from(value, "base64url");
  if (payload.length < 29) throw new Error("invalid encrypted market contact");
  const decipher = crypto.createDecipheriv("aes-256-gcm", contactKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

export function maskMarketContact(method: string, rawValue: string) {
  const value = rawValue.trim();
  if (method === "email" || value.includes("@")) {
    const [name = "", host = ""] = value.split("@", 2);
    return `${name.slice(0, 2) || "*"}***@${host || "***"}`;
  }
  const compact = value.replace(/[\s-]/g, "");
  if (method === "phone" && compact.length >= 7) return `${compact.slice(0, 3)}****${compact.slice(-4)}`;
  if (compact.length <= 4) return `${compact.slice(0, 1)}***${compact.slice(-1)}`;
  return `${compact.slice(0, 2)}***${compact.slice(-2)}`;
}

function trustLevel(score: number) {
  if (score >= 90) return { code: "excellent", label: "信用优秀" };
  if (score >= 75) return { code: "reliable", label: "信用可靠" };
  if (score >= 60) return { code: "normal", label: "信用正常" };
  return { code: "caution", label: "交易需谨慎" };
}

export function calculateMarketTrustScore(input: {
  identityVerified: boolean;
  completedTradeCount: number;
  averageRating: number;
  positiveReviewCount: number;
  reviewCount: number;
  noShowCount: number;
  cancelledByUserCount: number;
  activeViolations: Array<{ level: string }>;
  transactionPoints?: number;
  creatorQualityScore?: number | null;
}) {
  const identityPoints = input.identityVerified ? 10 : 0;
  const tradePoints = Math.min(15, input.completedTradeCount * 2);
  const ratingPoints = input.reviewCount > 0
    ? Math.min(15, Math.round((input.averageRating / 5) * 10 + (input.positiveReviewCount / input.reviewCount) * 5))
    : 0;
  const violationPenalty = input.activeViolations.reduce((sum, violation) => {
    if (violation.level === "serious") return sum + 20;
    if (violation.level === "moderate") return sum + 12;
    return sum + 6;
  }, 0);
  const contributionPoints = Math.min(5, Math.floor(Math.max(0, input.transactionPoints || 0) / 100));
  const creatorQualityPoints = input.creatorQualityScore === null || input.creatorQualityScore === undefined
    ? 0
    : Math.max(-3, Math.min(3, Math.round((input.creatorQualityScore - 60) / 15)));
  const score = Math.max(0, Math.min(100, 60 + identityPoints + tradePoints + ratingPoints
    + contributionPoints + creatorQualityPoints
    - input.noShowCount * 8 - input.cancelledByUserCount * 2 - violationPenalty));
  return { score, ...trustLevel(score) };
}

export async function getMarketTrustProfile(prisma: any, userId: number, includePrivate = false) {
  const now = new Date();
  await expireMarketViolations(prisma, now);
  const [
    user,
    physicalCompletedTradeCount,
    learningCompletedTradeCount,
    physicalReviewSummary,
    physicalPositiveReviewCount,
    learningReviewSummary,
    learningPositiveReviewCount,
    noShowCount,
    cancelledByUserCount,
    activeViolations,
    activeLearningViolations,
    creatorProfile,
    recentPointEntries,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        avatar: true,
        role: true,
        studentSso: true,
        transactionPoints: true,
        createdAt: true,
      },
    }),
    prisma.marketOrder.count({
      where: {
        status: "completed",
        deliveryType: "physical",
        learningCommerceOrder: { is: null },
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
    }),
    prisma.learningCommerceOrder.count({
      where: {
        status: "completed",
        order: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      },
    }),
    prisma.marketReview.aggregate({
      where: {
        targetUserId: userId,
        order: {
          deliveryType: "physical",
          learningCommerceOrder: { is: null },
        },
      },
      _avg: { rating: true },
      _count: true,
    }),
    prisma.marketReview.count({
      where: {
        targetUserId: userId,
        rating: { gte: 4 },
        order: {
          deliveryType: "physical",
          learningCommerceOrder: { is: null },
        },
      },
    }),
    prisma.learningMaterialRating.aggregate({
      where: { creatorId: userId, status: "published" },
      _avg: { overall: true },
      _count: true,
    }),
    prisma.learningMaterialRating.count({
      where: { creatorId: userId, status: "published", overall: { gte: 4 } },
    }),
    prisma.marketOrder.count({
      where: { OR: [{ buyerId: userId, noShowParty: "buyer" }, { sellerId: userId, noShowParty: "seller" }] },
    }),
    prisma.marketOrder.count({ where: { cancelledById: userId } }),
    prisma.marketViolation.findMany({
      where: { userId, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: includePrivate
        ? { id: true, type: true, level: true, action: true, reason: true, status: true, expiresAt: true, createdAt: true, appeals: { select: { id: true, status: true, content: true, handledNote: true, createdAt: true } } }
        : { id: true, level: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.learningCreatorViolation.findMany({
      where: {
        creatorId: userId,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: includePrivate
        ? {
          id: true,
          type: true,
          severity: true,
          action: true,
          reason: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          appeals: {
            select: {
              id: true,
              status: true,
              content: true,
              handleNote: true,
              createdAt: true,
            },
          },
        }
        : { id: true, severity: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.learningCreatorProfile.findUnique({
      where: { userId },
      select: {
        status: true,
        level: true,
        qualityScore: true,
        completedOrderCount: true,
        averageRatingBps: true,
        refundRateBps: true,
        disputeRateBps: true,
      },
    }),
    includePrivate
      ? prisma.transactionPointEntry.findMany({
        where: { userId },
        select: {
          id: true,
          delta: true,
          event: true,
          sourceType: true,
          sourceId: true,
          reason: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      })
      : Promise.resolve([]),
  ]);
  if (!user) throw Errors.notFound("用户不存在");
  const identityVerified = Boolean(user.studentSso || ["admin", "mod"].includes(user.role));
  const physicalReviewCount = Number(physicalReviewSummary._count || 0);
  const learningReviewCount = Number(learningReviewSummary._count || 0);
  const reviewCount = physicalReviewCount + learningReviewCount;
  const positiveReviewCount = physicalPositiveReviewCount + learningPositiveReviewCount;
  const averageRating = reviewCount
    ? (
      Number(physicalReviewSummary._avg.rating || 0) * physicalReviewCount
      + Number(learningReviewSummary._avg.overall || 0) * learningReviewCount
    ) / reviewCount
    : 0;
  const completedTradeCount = physicalCompletedTradeCount + learningCompletedTradeCount;
  const normalizedLearningViolations = activeLearningViolations.map((violation: any) => ({
    level: violation.severity === "critical" || violation.severity === "high"
      ? "serious"
      : violation.severity === "medium"
        ? "moderate"
        : "warning",
  }));
  const trust = calculateMarketTrustScore({
    identityVerified,
    completedTradeCount,
    averageRating,
    positiveReviewCount,
    reviewCount,
    noShowCount,
    cancelledByUserCount,
    activeViolations: [...activeViolations, ...normalizedLearningViolations],
    transactionPoints: user.transactionPoints,
    creatorQualityScore: creatorProfile?.qualityScore,
  });
  const pointLevel = transactionPointLevel(user.transactionPoints);
  const isNew = completedTradeCount === 0 && reviewCount === 0;
  return {
    user: {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      studentSso: user.studentSso,
      createdAt: user.createdAt,
    },
    identity: { verified: identityVerified, label: identityVerified ? "校园身份已核验" : "校园身份未核验" },
    ...trust,
    isNew,
    historyLabel: isNew ? "新用户，暂无交易历史" : `已完成 ${completedTradeCount} 笔可信交易`,
    completedTradeCount,
    physicalCompletedTradeCount,
    learningCompletedTradeCount,
    averageRating,
    reviewCount,
    physicalReviewCount,
    learningReviewCount,
    positiveRate: reviewCount ? Math.round((positiveReviewCount / reviewCount) * 100) : 0,
    noShowCount,
    cancelledByUserCount,
    activeViolationCount: activeViolations.length + activeLearningViolations.length,
    transactionPoints: {
      ...pointLevel,
      recentEntries: includePrivate ? recentPointEntries : undefined,
    },
    creator: creatorProfile,
    restrictions: includePrivate ? activeViolations : undefined,
    learningRestrictions: includePrivate ? activeLearningViolations : undefined,
  };
}

const sensitiveDetailKey = /contact|account|phone|wechat|qq|email|realname|password|token|secret|encrypted|联系方式|手机号|微信|邮箱/i;

export function sanitizeAdminLogDetail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAdminLogDetail);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !sensitiveDetailKey.test(key))
    .map(([key, nested]) => [key, sanitizeAdminLogDetail(nested)]));
}

export async function logMarketAdminAction(prisma: any, input: {
  actorId?: number | null;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  summary: string;
  detail?: unknown;
  ip?: string;
}) {
  const detail = JSON.stringify(sanitizeAdminLogDetail(input.detail ?? {})).slice(0, 4000);
  return prisma.adminActionLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId === null || input.targetId === undefined ? "" : String(input.targetId),
      summary: input.summary.slice(0, 500),
      detail,
      ip: (input.ip || "").slice(0, 120),
    },
  });
}
