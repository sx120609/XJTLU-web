import { prisma } from "../prisma";
import { runTrackedJob } from "./runtimeHealth";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_STALE_MS = 5 * 60 * 1000;

export type HotScoreResult = {
  score: number;
  reasons: string[];
  signals: Record<string, number | string | boolean>;
};

function finite(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function timeDecay(createdAt: Date | string, halfLifeDays: number, now = new Date()) {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  return Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
}

function latestActivityAt(primary: Date | string, secondary?: Date | string | null) {
  const primaryAt = new Date(primary);
  const secondaryAt = secondary ? new Date(secondary) : null;
  const validPrimary = Number.isFinite(primaryAt.getTime());
  const validSecondary = Boolean(secondaryAt && Number.isFinite(secondaryAt.getTime()));
  if (!validPrimary) return validSecondary ? secondaryAt! : new Date(0);
  return validSecondary && secondaryAt! > primaryAt ? secondaryAt! : primaryAt;
}

export function boundedSignal(count: number, weight: number, cap: number) {
  return Math.min(cap, Math.log1p(Math.max(0, finite(count))) * weight);
}

function result(
  raw: number,
  decay: number,
  reasonPairs: Array<[string, number]>,
  signals: HotScoreResult["signals"],
) {
  const reasons = reasonPairs
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label);
  if (!reasons.length) reasons.push("近期发布");
  return {
    score: Math.max(0, Math.min(100, Math.round(raw * decay))),
    reasons,
    signals,
  };
}

export function scorePhysicalItem(input: {
  createdAt: Date | string;
  views: number;
  favorites: number;
  offers: number;
  contacts: number;
  completed: number;
  reports: number;
  sellerPoints: number;
}, now = new Date()): HotScoreResult {
  const views = boundedSignal(input.views, 0.7, 4);
  const favorites = boundedSignal(input.favorites, 2.2, 12);
  const offers = boundedSignal(input.offers, 2.8, 14);
  const contacts = boundedSignal(input.contacts, 3, 15);
  const completed = boundedSignal(input.completed, 7, 28);
  const trust = Math.min(8, Math.max(0, input.sellerPoints) / 75);
  const governancePenalty = Math.min(45, Math.max(0, input.reports) * 12);
  const raw = Math.max(0, 8 + views + favorites + offers + contacts + completed + trust - governancePenalty);
  return result(raw, timeDecay(input.createdAt, 21, now), [
    ["近期成交活跃", completed],
    ["同学收藏较多", favorites],
    ["咨询意向较高", contacts + offers],
    ["卖家交易记录可靠", trust],
  ], {
    views: input.views,
    favorites: input.favorites,
    offers: input.offers,
    contacts: input.contacts,
    completed: input.completed,
    reports: input.reports,
  });
}

export function scoreLearningMaterial(input: {
  createdAt: Date | string;
  contentUpdatedAt?: Date | string | null;
  views: number;
  favorites: number;
  completed: number;
  ratingCount: number;
  averageRating: number;
  issueCount: number;
  refundCount: number;
  creatorQuality: number;
  reports: number;
}, now = new Date()): HotScoreResult {
  const views = boundedSignal(input.views, 0.5, 3);
  const favorites = boundedSignal(input.favorites, 2, 10);
  const completed = boundedSignal(input.completed, 8, 32);
  const rating = Math.min(20, Math.max(0, input.ratingCount) * Math.max(0, input.averageRating - 2.5) * 1.5);
  const quality = Math.max(-5, Math.min(10, (input.creatorQuality - 50) / 5));
  const governancePenalty = Math.min(55, input.issueCount * 6 + input.refundCount * 10 + input.reports * 12);
  const raw = Math.max(0, 8 + views + favorites + completed + rating + quality - governancePenalty);
  const activityAt = latestActivityAt(input.createdAt, input.contentUpdatedAt);
  return result(raw, timeDecay(activityAt, 45, now), [
    ["已购同学评价较好", rating],
    ["真实成交较多", completed],
    ["创作者质量稳定", quality],
    ["同学收藏较多", favorites],
  ], {
    views: input.views,
    favorites: input.favorites,
    completed: input.completed,
    ratingCount: input.ratingCount,
    averageRating: Number(input.averageRating.toFixed(2)),
    issueCount: input.issueCount,
    refundCount: input.refundCount,
    reports: input.reports,
    contentUpdatedAt: activityAt.toISOString(),
  });
}

export function scoreWantedPost(input: {
  createdAt: Date | string;
  views: number;
  validResponses: number;
  completed: number;
  urgent: boolean;
  reports: number;
  authorPoints: number;
}, now = new Date()): HotScoreResult {
  const views = boundedSignal(input.views, 0.6, 4);
  const responses = boundedSignal(input.validResponses, 4, 20);
  const completed = boundedSignal(input.completed, 8, 24);
  const urgency = input.urgent ? 8 : 0;
  const trust = Math.min(6, Math.max(0, input.authorPoints) / 100);
  const penalty = Math.min(40, input.reports * 12);
  const raw = Math.max(0, 8 + views + responses + completed + urgency + trust - penalty);
  return result(raw, timeDecay(input.createdAt, 10, now), [
    ["已有有效响应", responses],
    ["需求较紧急", urgency],
    ["求购人交易记录可靠", trust],
  ], {
    views: input.views,
    validResponses: input.validResponses,
    completed: input.completed,
    urgent: input.urgent,
    reports: input.reports,
  });
}

export function scoreTopic(input: {
  createdAt: Date | string;
  lastReplyAt?: Date | string | null;
  views: number;
  likes: number;
  replies: number;
  pinned: boolean;
  riskScore: number;
  authorPoints: number;
}, now = new Date()): HotScoreResult {
  const views = boundedSignal(input.views, 0.5, 4);
  const likes = boundedSignal(input.likes, 2.8, 18);
  const replies = boundedSignal(input.replies, 3.5, 22);
  const trust = Math.min(4, Math.max(0, input.authorPoints) / 150);
  const penalty = Math.min(45, Math.max(0, input.riskScore - 30) * 0.8);
  const raw = Math.max(0, 7 + views + likes + replies + trust - penalty);
  const activityAt = latestActivityAt(input.createdAt, input.lastReplyAt);
  const scored = result(raw, timeDecay(activityAt, 14, now), [
    ["讨论参与较多", replies],
    ["同学点赞较多", likes],
    ["近期阅读活跃", views],
  ], {
    views: input.views,
    likes: input.likes,
    replies: input.replies,
    riskScore: input.riskScore,
    lastActivityAt: activityAt.toISOString(),
  });
  // 置顶只控制展示顺序，不伪装成自然热度。
  return { ...scored, signals: { ...scored.signals, pinned: input.pinned } };
}

export function parseHotSignals(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "{}");
    return {
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((reason: unknown) => typeof reason === "string").slice(0, 3)
        : [],
      signals: parsed.signals && typeof parsed.signals === "object" ? parsed.signals : {},
    };
  } catch {
    return { reasons: [] as string[], signals: {} };
  }
}

function serializeScore(score: HotScoreResult) {
  return JSON.stringify({ reasons: score.reasons, signals: score.signals });
}

export async function refreshV1HotRanking(now = new Date()) {
  const activeTopicCutoff = new Date(now.getTime() - 180 * 86_400_000);
  const [items, wantedPosts, topics] = await Promise.all([
    prisma.marketItem.findMany({
      where: { status: "active", visibility: "public" },
      select: {
        id: true,
        deliveryType: true,
        createdAt: true,
        viewCount: true,
        favoriteCount: true,
        offerCount: true,
        learningMaterial: {
          select: {
            activeVersion: {
              select: {
                publishedAt: true,
                updatedAt: true,
              },
            },
          },
        },
        seller: {
          select: {
            transactionPoints: true,
            learningCreatorProfile: { select: { qualityScore: true } },
          },
        },
        _count: {
          select: {
            conversations: true,
            reports: { where: { status: "resolved" } },
            orders: { where: { status: "completed" } },
          },
        },
        learningMaterialRatings: {
          where: { status: "published" },
          select: { overall: true },
        },
        orders: {
          where: { learningCommerceOrder: { isNot: null } },
          select: {
            learningCommerceOrder: {
              select: {
                status: true,
                issues: { select: { id: true } },
              },
            },
          },
        },
      },
    }),
    prisma.wantedPost.findMany({
      where: { status: { in: ["active", "responded", "matched"] }, expiresAt: { gt: now } },
      select: {
        id: true,
        createdAt: true,
        viewCount: true,
        urgentUntil: true,
        author: { select: { transactionPoints: true } },
        _count: {
          select: {
            responses: { where: { status: { in: ["accepted", "pending"] } } },
            reservations: { where: { status: "completed" } },
            reports: { where: { status: "resolved" } },
          },
        },
      },
    }),
    prisma.topic.findMany({
      where: {
        hidden: false,
        OR: [
          { createdAt: { gte: activeTopicCutoff } },
          { lastReplyAt: { gte: activeTopicCutoff } },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        viewCount: true,
        likeCount: true,
        replyCount: true,
        lastReplyAt: true,
        pinned: true,
        aiRiskScore: true,
        author: { select: { transactionPoints: true } },
      },
    }),
  ]);

  const itemUpdates = items.map((item) => {
    const learningOrders = item.orders
      .map((order) => order.learningCommerceOrder)
      .filter(Boolean);
    const completedLearning = learningOrders.filter((order) => order?.status === "completed").length;
    const refunds = learningOrders.filter((order) => order?.status === "refunded").length;
    const issueCount = learningOrders.reduce((sum, order) => sum + (order?.issues.length || 0), 0);
    const ratingCount = item.learningMaterialRatings.length;
    const averageRating = ratingCount
      ? item.learningMaterialRatings.reduce((sum, rating) => sum + rating.overall, 0) / ratingCount
      : 0;
    const score = item.deliveryType === "digital"
      ? scoreLearningMaterial({
        createdAt: item.createdAt,
        contentUpdatedAt: item.learningMaterial?.activeVersion?.updatedAt
          || item.learningMaterial?.activeVersion?.publishedAt,
        views: item.viewCount,
        favorites: item.favoriteCount,
        completed: completedLearning,
        ratingCount,
        averageRating,
        issueCount,
        refundCount: refunds,
        creatorQuality: item.seller.learningCreatorProfile?.qualityScore || 50,
        reports: item._count.reports,
      }, now)
      : scorePhysicalItem({
        createdAt: item.createdAt,
        views: item.viewCount,
        favorites: item.favoriteCount,
        offers: item.offerCount,
        contacts: item._count.conversations,
        completed: item._count.orders,
        reports: item._count.reports,
        sellerPoints: item.seller.transactionPoints,
      }, now);
    return prisma.marketItem.update({
      where: { id: item.id },
      data: { hotScore: score.score, hotSignals: serializeScore(score), hotScoreUpdatedAt: now },
    });
  });

  const wantedUpdates = wantedPosts.map((post) => {
    const score = scoreWantedPost({
      createdAt: post.createdAt,
      views: post.viewCount,
      validResponses: post._count.responses,
      completed: post._count.reservations,
      urgent: Boolean(post.urgentUntil && post.urgentUntil > now),
      reports: post._count.reports,
      authorPoints: post.author.transactionPoints,
    }, now);
    return prisma.wantedPost.update({
      where: { id: post.id },
      data: { hotScore: score.score, hotSignals: serializeScore(score), hotScoreUpdatedAt: now },
    });
  });

  const topicUpdates = topics.map((topic) => {
    const score = scoreTopic({
      createdAt: topic.createdAt,
      lastReplyAt: topic.lastReplyAt,
      views: topic.viewCount,
      likes: topic.likeCount,
      replies: topic.replyCount,
      pinned: topic.pinned,
      riskScore: topic.aiRiskScore || 0,
      authorPoints: topic.author.transactionPoints,
    }, now);
    return prisma.topic.update({
      where: { id: topic.id },
      data: { hotScore: score.score, hotSignals: serializeScore(score), hotScoreUpdatedAt: now },
    });
  });

  const operations = [...itemUpdates, ...wantedUpdates, ...topicUpdates];
  for (let index = 0; index < operations.length; index += 100) {
    await prisma.$transaction(operations.slice(index, index + 100));
  }
  await prisma.topic.updateMany({
    where: {
      hidden: false,
      createdAt: { lt: activeTopicCutoff },
      AND: [
        { OR: [{ lastReplyAt: null }, { lastReplyAt: { lt: activeTopicCutoff } }] },
        { OR: [{ hotScore: { gt: 0 } }, { hotScoreUpdatedAt: null }] },
      ],
    },
    data: {
      hotScore: 0,
      hotSignals: serializeScore({
        score: 0,
        reasons: ["历史内容"],
        signals: { expiredFromHotRanking: true },
      }),
      hotScoreUpdatedAt: now,
    },
  });
  return { items: items.length, wantedPosts: wantedPosts.length, topics: topics.length };
}

let lastRefreshAt = 0;
let refreshPromise: Promise<unknown> | null = null;

export async function ensureV1HotRankingFresh(force = false) {
  if (!force && Date.now() - lastRefreshAt < MAX_STALE_MS) return true;
  if (!refreshPromise) {
    refreshPromise = refreshV1HotRanking()
      .then(() => {
        lastRefreshAt = Date.now();
        return true;
      })
      .catch((error) => {
        console.error("[v1-discovery] hot ranking refresh failed", error);
        return false;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export function startV1HotRankingPoller() {
  const tick = () => runTrackedJob(
    "v1-hot-ranking",
    "V1 热门内容排序",
    async () => {
      await refreshV1HotRanking();
      lastRefreshAt = Date.now();
    },
    REFRESH_INTERVAL_MS,
  ).catch((error) => {
    console.error("[v1-discovery] scheduled refresh failed", error);
  });
  void tick();
  const timer = setInterval(tick, REFRESH_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
