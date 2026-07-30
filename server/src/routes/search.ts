import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { withCache } from "../services/cache";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { getFeatures } from "../services/siteSettings";
import { resolveForumAccess } from "../services/forumAccess";
import { authOptional } from "../middleware/auth";
import { refreshExpiredPromotions, serializeItemPromotions, serializeWantedPromotion } from "../services/promotion";

export const searchRouter = Router();
searchRouter.use(authOptional);

/** 全局搜索：商品 / 求购 + 帖子 + 校园资源。 */
searchRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return ok(res, { marketItems: [], wantedPosts: [], topics: [], courses: [], services: [] });
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    const features = getFeatures();
    const searchableBoardTypes = ["announce"];
    if (forumAccessEnabled && features.forum) searchableBoardTypes.push("normal", "question", "coursereview");
    await refreshExpiredPromotions();

    const cacheParts = [
      "v5-market-wanted-no-merchants",
      q,
      forumAccessEnabled ? "forum-enabled" : "announce-only",
      features.forum ? "forum-on" : "forum-off",
      features.market ? "market-on" : "market-off",
    ];
    const { marketItems, wantedPosts, topics, services } = await withCache("search", cacheParts, 60_000, async () => {
      const [marketItems, wantedPosts, topics, services] = await Promise.all([
        forumAccessEnabled && features.market
          ? prisma.marketItem.findMany({
            where: {
              status: "active",
              deliveryType: "physical",
              listingType: "sell",
              visibility: "public",
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { campus: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
                { brand: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              listingType: true,
              title: true,
              category: true,
              priceCents: true,
              negotiable: true,
              campus: true,
              createdAt: true,
              pinnedUntil: true,
              pinnedPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } },
              images: { select: { url: true }, orderBy: [{ sort: "asc" }, { id: "asc" }], take: 1 },
            },
            orderBy: { createdAt: "desc" },
            take: 12,
          })
          : Promise.resolve([]),
        forumAccessEnabled && features.market
          ? prisma.wantedPost.findMany({
            where: {
              status: { in: ["active", "responded"] },
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { brandModel: { contains: q, mode: "insensitive" } },
                { campus: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
              ],
            },
            select: { id: true, title: true, category: true, budgetMinCents: true, budgetMaxCents: true, campus: true, status: true, createdAt: true, urgentUntil: true, urgentPromotionOrder: { select: { id: true, status: true, type: true, startsAt: true, expiresAt: true } }, _count: { select: { responses: true } } },
            orderBy: { createdAt: "desc" },
            take: 12,
          })
          : Promise.resolve([]),
        prisma.topic.findMany({
          where: {
            hidden: false,
            // 商品和求购分别由结构化结果返回；帖子搜索只收公告与广场公开频道，
            // 避免同一出售商品再以内部市集 Topic 重复出现或被误认成求购讨论。
            board: {
              type: { in: searchableBoardTypes },
              OR: [{ type: "announce" }, { section: { not: null } }],
            },
            OR: [{ title: { contains: q } }, { content: { contains: q } }],
          },
          orderBy: { lastReplyAt: "desc" },
          take: 10,
          include: {
            board: { select: { slug: true, name: true } },
            author: { select: { nickname: true } },
            tags: { include: { tag: true } },
          },
        }),
        prisma.serviceCard.findMany({
          where: visibleServiceWhere({
            OR: [
              { name: { contains: q } },
              { category: { contains: q } },
              { owner: { contains: q } },
              { description: { contains: q } },
            ],
          }),
          take: 8,
        }),
      ]);
      return { marketItems, wantedPosts, topics, services };
    });

    ok(res, {
      marketItems: marketItems.map((item) => ({
        id: item.id,
        listingType: item.listingType,
        title: item.title,
        category: item.category,
        price: (item.priceCents / 100).toFixed(2),
        priceCents: item.priceCents,
        negotiable: item.negotiable,
        campus: item.campus,
        cover: item.images[0]?.url || "",
        createdAt: item.createdAt,
        promotions: serializeItemPromotions(item),
      })),
      wantedPosts: wantedPosts.map((post) => ({
        id: post.id,
        title: post.title,
        category: post.category,
        budgetMin: (post.budgetMinCents / 100).toFixed(2),
        budgetMax: (post.budgetMaxCents / 100).toFixed(2),
        campus: post.campus,
        status: post.status,
        responseCount: post._count.responses,
        createdAt: post.createdAt,
        promotion: serializeWantedPromotion(post),
      })),
      topics: topics.map((topic: any) => ({
        ...topic,
        metadata: safeJson(topic.metadata),
        tags: Array.isArray(topic.tags)
          ? topic.tags.map((item: any) => item?.tag ? { id: item.tag.id, name: item.tag.name } : item).filter((item: any) => item?.name)
          : [],
      })),
      courses: [],
      services: services.map(normalizeServiceCard),
    });
  } catch (e) { next(e); }
});

function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
