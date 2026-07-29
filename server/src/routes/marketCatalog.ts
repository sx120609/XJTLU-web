import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger, queryPage, querySize } from "../utils/query";
import { isFeatureOn } from "../services/siteSettings";
import {
  resolveMarketCategoryBoundary,
  type MarketCatalogScope,
} from "../services/marketCatalog";
import { MARKET_PUBLIC_USER_SELECT } from "../services/marketPublicUser";
import {
  buildMarketMeta,
  cents,
  closeExpiredMarketOrders,
  ensureMarketCategories,
  getMarketConfig,
  ITEM_CONDITIONS,
  itemInclude,
  normalizeMarketTradeMode,
  queryMarketCampus,
  serializeItem,
  TRADE_MODES,
} from "../services/marketCatalogService";
import { serializeWantedPost } from "../services/marketWantedService";
import { findMatchesForItem } from "../services/marketMatching";
import { marketCampusStorageAliases } from "../services/marketCampus";

// Public, read-oriented marketplace endpoints. URLs and response envelopes
// remain mounted under /api/market by the parent market router.
const PRIVATE_ITEM_STATUSES = new Set(["draft", "reviewing", "hidden"]);

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
    const orderBy: any = [
      { pinnedUntil: { sort: "desc", nulls: "last" } },
      ...(Array.isArray(contentOrderBy) ? contentOrderBy : [contentOrderBy]),
    ];
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
  } catch (error) {
    next(error);
  }
}

export const marketCatalogRouter = Router();

marketCatalogRouter.get("/meta", async (_req, res, next) => {
  try {
    await ensureMarketCategories();
    const marketConfig = await getMarketConfig();
    const allCategories = await prisma.marketCategory.findMany({
      where: { enabled: true },
      orderBy: [{ sort: "asc" }, { id: "asc" }],
    });
    ok(res, buildMarketMeta(allCategories, marketConfig));
  } catch (error) {
    next(error);
  }
});

marketCatalogRouter.get("/items", (req, res, next) => listMarketItems(req, res, next, "market"));

marketCatalogRouter.get("/items/:id", async (req, res, next) => {
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
    const isOwnerOrStaff = Boolean(
      item && (req.user?.userId === item.sellerId || ["admin", "mod"].includes(req.user?.role || "")),
    );
    if (!item || (PRIVATE_ITEM_STATUSES.has(item.status) && !isOwnerOrStaff)) {
      throw Errors.notFound("商品不存在");
    }
    if (
      item.visibility === "targeted"
      && req.user?.userId !== item.sellerId
      && !["admin", "mod"].includes(req.user?.role || "")
    ) {
      const wanted = item.sourceWantedPostId
        ? await prisma.wantedPost.findUnique({ where: { id: item.sourceWantedPostId }, select: { authorId: true } })
        : null;
      if (!wanted || wanted.authorId !== req.user?.userId) throw Errors.notFound("商品不存在");
    }
    if (item.status !== "draft") {
      prisma.marketItem.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => null);
    }
    const rating = await prisma.marketReview.aggregate({
      where: { targetUserId: item.sellerId },
      _avg: { rating: true },
      _count: true,
    });
    ok(res, {
      ...serializeItem(item, req.user?.userId),
      sellerRating: rating._avg.rating || 0,
      sellerReviewCount: rating._count,
    });
  } catch (error) {
    next(error);
  }
});

marketCatalogRouter.get("/items/:id/matches", async (req, res, next) => {
  try {
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("商品 ID 不合法");
    const item = await prisma.marketItem.findUnique({
      where: { id },
      select: { id: true, status: true, visibility: true },
    });
    if (!item || item.status !== "active" || item.visibility !== "public") {
      throw Errors.notFound("商品不存在或已结束");
    }
    const matches = await findMatchesForItem(id, 8);
    const rows = await prisma.wantedPost.findMany({
      where: { id: { in: matches.map((match) => match.wantedPost.id) } },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        urgentPromotionOrder: {
          select: { id: true, status: true, type: true, startsAt: true, expiresAt: true },
        },
        _count: { select: { responses: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    ok(res, matches.flatMap((match) => {
      const wantedPost = byId.get(match.wantedPost.id);
      return wantedPost
        ? [{ wantedPost: serializeWantedPost(wantedPost, req.user?.userId), score: match.score, reasons: match.reasons }]
        : [];
    }));
  } catch (error) {
    next(error);
  }
});
