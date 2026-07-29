import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { queryPage, querySize } from "../utils/query";
import { withCache } from "../services/cache";
import { verifyToken } from "../utils/jwt";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { enabledBoardTypes, getGlobalPinnedTopicIds } from "../services/siteSettings";
import { isForumStaffRole, resolveForumAccess } from "../services/forumAccess";
import { decodeTopicForViewer } from "../services/forumPresentation";
import { buildUserTrustSnapshot } from "../services/userTrust";
import { WEIWALL_BOARD_SLUG } from "../services/weiwallSync";
import { amountCentsToMoney } from "../services/epay";
import { MARKET_PUBLIC_USER_SELECT } from "../services/marketPublicUser";
import { refreshExpiredPromotions, serializeItemPromotions, serializeWantedPromotion } from "../services/promotion";
import { detectLoginClient } from "../utils/loginClient";
import { notificationTargetClientWhere } from "../services/notificationTargeting";

export const homeRouter = Router();
const HOME_HIDDEN_SERVICE_CODES = ["DORM_REPAIR"];
const HOT_TOPIC_DEFAULT_SIZE = 10;
const LATEST_FEED_DEFAULT_SIZE = 20;

/**
 * 首页摘要：热榜 + 最新聚合 + 学校公告 + 服务卡片 + 个人未读
 * - 已登录：返回 identity / unreadCount
 * - 游客：identity = null，其他公开内容仍返回
 */
homeRouter.get("/summary", async (req, res, next) => {
  try {
    let userId: number | null = req.user?.userId ?? null;
    let role: string | null = req.user?.role ?? null;
    const auth = req.headers.authorization;
    if (!userId && auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }

    const clientTargetWhere = notificationTargetClientWhere(
      detectLoginClient(req).client,
    );
    const [user, personalUnread, globalUnread] = await Promise.all([
      userId ? prisma.user.findUnique({ where: { id: userId } }) : Promise.resolve(null),
      userId
        ? prisma.notification.count({
          where: { userId, readAt: null, ...clientTargetWhere },
        })
        : Promise.resolve(0),
      userId
        ? prisma.notification.count({
          where: {
            userId: null,
            ...clientTargetWhere,
            reads: { none: { userId } },
          },
        })
        : Promise.resolve(0),
    ]);
    const forumAccessEnabled = user ? (isForumStaffRole(user.role) || user.forumEnabled) : await resolveForumAccess(userId, role);
    const trust = user ? buildUserTrustSnapshot(user) : null;
    const readableBoardTypes = enabledBoardTypes();
    const contentBoardTypes = readableBoardTypes.filter((type) => type !== "announce");
    const globalPinnedIds = getGlobalPinnedTopicIds();
    await refreshExpiredPromotions();
    const publicSummary = await withCache(
      "home",
      ["summary-xjtlu-v4-square-only", forumAccessEnabled ? "forum-enabled" : "announce-only"],
      60_000,
      async () => {
        const [pinnedTopics, hotTopics, latestTopics, announce, services] = await Promise.all([
          forumAccessEnabled ? listGlobalPinnedTopics(globalPinnedIds, contentBoardTypes, 6) : Promise.resolve([]),
          forumAccessEnabled ? listHotTopics(16, contentBoardTypes) : Promise.resolve([]),
          forumAccessEnabled ? prisma.topic.findMany({
            where: { hidden: false, id: { notIn: globalPinnedIds }, board: publicSquareBoardWhere(contentBoardTypes) },
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              board: { select: { slug: true, name: true, color: true, type: true } },
              author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
              tags: { include: { tag: true } },
            },
          }) : Promise.resolve([]),
          prisma.topic.findMany({
            where: {
              hidden: false,
              board: {
                readOnly: true,
                slug: { not: WEIWALL_BOARD_SLUG },
                OR: [
                  { feedSourceId: null },
                  { feedSource: { is: { enabled: true } } },
                ],
              },
            },
            orderBy: { createdAt: "desc" },
            take: 8,
            include: { board: { select: { slug: true, name: true } }, tags: { include: { tag: true } } },
          }),
          prisma.serviceCard.findMany({
            where: visibleServiceWhere(),
            orderBy: [{ order: "asc" }, { id: "asc" }],
            take: 8,
          }),
        ]);
        return { pinnedTopics, hotTopics, latestTopics, announce, services };
      },
    );
    // 推广位必须在管理员确认后立即生效，不进入一分钟的首页内容缓存。
    const promotionNow = new Date();
    const topicInclude = {
      board: { select: { slug: true, name: true, color: true, type: true } },
      author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
      tags: { include: { tag: true } },
      linkedWantedPost: {
        include: { urgentPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } } },
      },
    } as const;
    const [promotions, promotedWantedTopics] = await Promise.all([prisma.marketItem.findMany({
      where: {
        status: "active",
        visibility: "public",
        deliveryType: "physical",
        homeFeaturedUntil: { gt: promotionNow },
        homePromotionOrderId: { not: null },
        homePromotionOrder: { is: { status: "confirmed", startsAt: { lte: promotionNow }, expiresAt: { gt: promotionNow } } },
      },
      orderBy: [{ homeFeaturedUntil: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: {
        seller: { select: MARKET_PUBLIC_USER_SELECT },
        images: { orderBy: [{ sort: "asc" }, { id: "asc" }], take: 1 },
        homePromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
      },
    }), forumAccessEnabled ? prisma.topic.findMany({
      where: {
        hidden: false,
        board: publicSquareBoardWhere(contentBoardTypes),
        linkedWantedPost: {
          is: {
            status: { in: ["active", "responded"] },
            urgentUntil: { gt: promotionNow },
            urgentPromotionOrderId: { not: null },
            urgentPromotionOrder: { is: { status: "confirmed", startsAt: { lte: promotionNow }, expiresAt: { gt: promotionNow } } },
          },
        },
      },
      orderBy: [{ linkedWantedPost: { urgentUntil: "desc" } }, { createdAt: "desc" }],
      take: 8,
      include: topicInclude,
    }) : Promise.resolve([])]);

    const promotedHotTopics = promotedWantedTopics.map((item: any) => ({
      ...decodeTopicForViewer(item, { userId, role }),
      promotion: serializeWantedPromotion(item.linkedWantedPost, promotionNow).urgent,
    }));
    const promotedTopicIds = new Set(promotedHotTopics.map((item: any) => item.id));
    const naturalHotTopics = forumAccessEnabled ? publicSummary.hotTopics
      .filter((item: any) => !promotedTopicIds.has(item.id))
      .map((item: any) => decodeTopicForViewer(item, { userId, role })) : [];
    const mergedHotTopics = [...promotedHotTopics, ...naturalHotTopics].slice(0, 8);

    const unreadCount = personalUnread + globalUnread;

    ok(res, {
      identity: user ? {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar,
        college: user.college,
        role: user.role,
        postCount: user.postCount,
        replyCount: user.replyCount,
        reputation: trust?.reputation ?? 0,
        forumEnabled: forumAccessEnabled,
        unreadCount,
      } : null,
      pinnedTopics: forumAccessEnabled ? publicSummary.pinnedTopics.map((item: any) => decodeTopicForViewer(item, { userId, role })) : [],
      hotTopics: mergedHotTopics.map((item: any, index: number) => ({
        rank: index + 1,
        hotScore: computeHotScore(item, isRecentTopic(item)),
        ...item,
      })),
      latestTopics: forumAccessEnabled ? publicSummary.latestTopics.map((item: any) => decodeTopicForViewer(item, { userId, role })) : [],
      announce: publicSummary.announce.map((item: any) => decodeTopicForViewer(item, { userId, role })),
      services: publicSummary.services
        .filter((s) => !HOME_HIDDEN_SERVICE_CODES.includes(s.code))
        .map(normalizeServiceCard),
      promotions: promotions.map((item: any) => ({
        id: item.id,
        sellerId: item.sellerId,
        title: item.title,
        description: item.description,
        category: item.category,
        price: amountCentsToMoney(item.priceCents),
        priceCents: item.priceCents,
        campus: item.campus,
        cover: item.images?.[0]?.url || "",
        seller: item.seller,
        listingType: "sell",
        negotiable: item.negotiable,
        createdAt: item.createdAt,
        promotion: serializeItemPromotions(item, promotionNow).home,
      })),
    });
  } catch (e) { next(e); }
});

homeRouter.get("/hot-ranking", async (_req, res, next) => {
  try {
    let userId: number | null = _req.user?.userId ?? null;
    let role: string | null = _req.user?.role ?? null;
    const auth = _req.headers.authorization;
    if (!userId && auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    if (!forumAccessEnabled) return ok(res, []);
    const contentBoardTypes = enabledBoardTypes().filter((type) => type !== "announce");
    const list = await withCache("home", ["hot-ranking-v2-square-only"], 60_000, async () => listHotTopics(HOT_TOPIC_DEFAULT_SIZE, contentBoardTypes));
    ok(res, list.map((item, index) => ({
      rank: index + 1,
      hotScore: computeHotScore(item, isRecentTopic(item)),
      ...decodeTopicForViewer(item, { userId, role }),
    })));
  } catch (e) { next(e); }
});

homeRouter.get("/latest-feed", async (req, res, next) => {
  try {
    let userId: number | null = req.user?.userId ?? null;
    let role: string | null = req.user?.role ?? null;
    const auth = req.headers.authorization;
    if (!userId && auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    if (!forumAccessEnabled) return ok(res, { page: 1, size: LATEST_FEED_DEFAULT_SIZE, total: 0, pins: [], list: [] });
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, LATEST_FEED_DEFAULT_SIZE, 10, 50);
    const contentBoardTypes = enabledBoardTypes().filter((type) => type !== "announce");
    const globalPinnedIds = getGlobalPinnedTopicIds();
    const where = { hidden: false, id: { notIn: globalPinnedIds }, board: publicSquareBoardWhere(contentBoardTypes) } as const;
    const cached = await withCache("home", ["latest-feed-v2-square-only", page, size], 60_000, async () => {
      const [pins, list, total] = await Promise.all([
        listGlobalPinnedTopics(globalPinnedIds, contentBoardTypes, 20),
        prisma.topic.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * size,
          take: size,
          include: {
            board: { select: { slug: true, name: true, color: true, type: true } },
            author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
            tags: { include: { tag: true } },
          },
        }),
        prisma.topic.count({ where }),
      ]);
      return { pins, list, total };
    });
    ok(res, {
      page,
      size,
      total: cached.total,
      pins: cached.pins.map((item: any) => decodeTopicForViewer(item, { userId, role })),
      list: cached.list.map((item: any) => decodeTopicForViewer(item, { userId, role })),
    });
  } catch (e) { next(e); }
});

async function listGlobalPinnedTopics(ids: number[], boardTypes: string[], limit = ids.length || 20) {
  const orderedIds = ids.slice(0, Math.max(0, limit));
  if (!orderedIds.length) return [];
  const include = {
    board: { select: { slug: true, name: true, color: true, type: true } },
    author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
    tags: { include: { tag: true } },
  } as const;
  const rows = await prisma.topic.findMany({
      where: {
        id: { in: orderedIds },
        hidden: false,
        board: publicSquareBoardWhere(boardTypes),
      },
    include,
  });
  const byId = new Map(rows.map((item) => [item.id, item]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
}

async function listHotTopics(size: number, boardTypes: string[]) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const include = {
    board: { select: { slug: true, name: true, color: true, type: true } },
    author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
    tags: { include: { tag: true } },
  } as const;
  const [recent, older] = await Promise.all([
    prisma.topic.findMany({
      where: {
        hidden: false,
        board: publicSquareBoardWhere(boardTypes),
        lastReplyAt: { gte: cutoff },
      },
      orderBy: [{ likeCount: "desc" }, { replyCount: "desc" }, { viewCount: "desc" }],
      take: 60,
      include,
    }),
    prisma.topic.findMany({
      where: {
        hidden: false,
        board: publicSquareBoardWhere(boardTypes),
        OR: [{ lastReplyAt: null }, { lastReplyAt: { lt: cutoff } }],
      },
      orderBy: [{ likeCount: "desc" }, { replyCount: "desc" }, { viewCount: "desc" }],
      take: 60,
      include,
    }),
  ]);

  const recentSorted = [...recent].sort((a, b) => computeHotScore(b, true) - computeHotScore(a, true));
  const olderSorted = [...older].sort((a, b) => computeHotScore(b, false) - computeHotScore(a, false));
  const merged = recentSorted.slice(0, size);
  if (merged.length < size) {
    merged.push(...olderSorted.slice(0, size - merged.length));
  }
  return merged;
}

/** 首页与广场聚合只读取公开 12 频道；内部市集、历史频道和公告不参与热议。 */
function publicSquareBoardWhere(boardTypes: string[]) {
  return {
    type: { in: boardTypes },
    section: { not: null },
    slug: { not: WEIWALL_BOARD_SLUG },
  } as const;
}

function computeHotScore(topic: any, recent: boolean) {
  const raw = (topic.likeCount ?? 0) * 5 + (topic.replyCount ?? 0) * 3 + (topic.viewCount ?? 0) * 0.03;
  return recent ? raw : raw * 0.72;
}

function isRecentTopic(topic: any) {
  const last = topic.lastReplyAt ? new Date(topic.lastReplyAt).getTime() : 0;
  return last >= Date.now() - 24 * 60 * 60 * 1000;
}
