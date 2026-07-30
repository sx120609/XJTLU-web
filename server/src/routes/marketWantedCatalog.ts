import { Router } from "express";
import { prisma } from "../prisma";
import { isFeatureOn } from "../services/siteSettings";
import {
  closeExpiredMarketOrders,
  itemInclude,
  queryMarketCampus,
  serializeItem,
} from "../services/marketCatalogService";
import {
  serializeWantedPost,
  serializeWantedResponse,
  visibleWantedResponses,
  wantedDemandTopicInclude,
} from "../services/marketWantedService";
import { MARKET_PUBLIC_USER_SELECT } from "../services/marketPublicUser";
import { findMatchesForWanted } from "../services/marketMatching";
import { marketCampusStorageAliases } from "../services/marketCampus";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger, queryPage, querySize } from "../utils/query";
import { ensureV1HotRankingFresh } from "../services/v1DiscoveryService";
import { recordUniqueContentView } from "../services/contentViews";
import { expirePointBoosts } from "../services/pointBoosts";

export const marketWantedCatalogRouter = Router();

marketWantedCatalogRouter.get("/wanted", async (req, res, next) => {
  try {
    if (!isFeatureOn("market")) throw Errors.forbidden("市集当前已关闭");
    await closeExpiredMarketOrders();
    await expirePointBoosts();
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
    const sort = String(req.query.sort || "new");
    if (!["new", "popular"].includes(sort)) throw Errors.badRequest("求购排序方式无效");
    if (sort === "popular") await ensureV1HotRankingFresh();
    const contentOrder = sort === "popular"
      ? [{ hotScore: "desc" as const }, { createdAt: "desc" as const }]
      : [{ createdAt: "desc" as const }];
    const [list, total] = await Promise.all([
      prisma.wantedPost.findMany({
        where,
        include: {
          author: { select: MARKET_PUBLIC_USER_SELECT },
          urgentPromotionOrder: {
            select: { id: true, status: true, type: true, startsAt: true, expiresAt: true },
          },
          linkedTopics: wantedDemandTopicInclude,
          _count: { select: { responses: true } },
        },
        orderBy: [
          ...(sort === "new" ? [{ urgentUntil: { sort: "desc" as const, nulls: "last" as const } }] : []),
          { boostedUntil: { sort: "desc" as const, nulls: "last" as const } },
          ...contentOrder,
        ],
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.wantedPost.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map((post) => serializeWantedPost(post, req.user?.userId)) });
  } catch (error) {
    next(error);
  }
});

marketWantedCatalogRouter.get("/wanted/:id", async (req, res, next) => {
  try {
    await closeExpiredMarketOrders();
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("求购 ID 不合法");
    const post = await prisma.wantedPost.findUnique({
      where: { id },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        urgentPromotionOrder: {
          select: { id: true, status: true, type: true, startsAt: true, expiresAt: true },
        },
        _count: { select: { responses: true } },
        linkedTopics: wantedDemandTopicInclude,
        responses: {
          include: {
            seller: { select: MARKET_PUBLIC_USER_SELECT },
            item: { include: itemInclude },
            reservation: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!post) throw Errors.notFound("求购不存在");
    const isOwner = post.authorId === req.user?.userId;
    const isStaff = ["admin", "mod"].includes(req.user?.role || "");
    if (["reviewing", "removed"].includes(post.status) && !isOwner && !isStaff) {
      throw Errors.notFound("求购不存在");
    }
    if (!["reviewing", "removed"].includes(post.status)) {
      recordUniqueContentView(req, "wanted_post", id).catch(() => null);
    }
    const responses = visibleWantedResponses(
      post.responses,
      post.authorId,
      req.user?.userId,
      req.user?.role,
    );
    ok(res, {
      ...serializeWantedPost(post, req.user?.userId),
      responses: responses.map(serializeWantedResponse),
    });
  } catch (error) {
    next(error);
  }
});

marketWantedCatalogRouter.get("/wanted/:id/matches", async (req, res, next) => {
  try {
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("求购 ID 不合法");
    const wanted = await prisma.wantedPost.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!wanted || !["active", "responded"].includes(wanted.status)) {
      throw Errors.notFound("求购不存在或已结束");
    }
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
      return item
        ? [{ item: serializeItem(item, req.user?.userId), score: match.score, reasons: match.reasons }]
        : [];
    }));
  } catch (error) {
    next(error);
  }
});
