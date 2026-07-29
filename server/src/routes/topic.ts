import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { queryPage, querySize } from "../utils/query";
import { withCache } from "../services/cache";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  enabledBoardTypes,
  featureClosedMessage,
  featureForBoardType,
  getSiteConfig,
  isBoardTypeEnabled,
  isFeatureOn,
  removeTopicFromGlobalPins,
  setTopicGlobalPinned,
} from "../services/siteSettings";
import { refreshBoardTopicCounts, refreshUserPostCount } from "../services/forumStats";
import {
  evaluateTopicEditSimilarity,
  ensureUserCanSubmitTopic,
  generateTopicAiTags,
  notifyTopicAiBlocked,
  refreshTopicSubmissionLock,
  requestManualTopicReview,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
  shouldRunAiReview,
  syncTopicAiTags,
} from "../services/topicAiReview";
import { autoFormatTopicContent } from "../services/topicAiFormat";
import { ensureCanReadBoardType, ensureForumAccessEnabled, resolveForumAccess } from "../services/forumAccess";
import { ensureUserCanSpeak, releaseExpiredMutes } from "../services/userModeration";
import { consumeAnonymousCredit, createAnonymousAlias } from "../services/userTrust";
import { decodeReplyForViewer, decodeReplyForViewerWithImages, decodeTopicForViewer, decodeTopicForViewerWithImages } from "../services/forumPresentation";
import { ensureForumImageAssetsForContent, summarizeForumImageModerationForContent } from "../services/imageModeration";
import { ensureForumVideoAssetsForContent, summarizeForumVideoModerationForContent } from "../services/videoModeration";
import { invalidateForumCaches } from "../services/cacheInvalidation";
import { WEIWALL_BOARD_SLUG } from "../services/weiwallSync";
import { evaluateMarketContent } from "../services/marketTrust";
import { WANTED_DEMAND_BOARD_SLUG } from "../services/defaultBoardCatalog";

export const topicRouter = Router();

const topicLinkInclude = {
  linkedMarketItem: {
    select: {
      id: true,
      title: true,
      category: true,
      status: true,
      priceCents: true,
      images: { select: { url: true }, orderBy: { sort: "asc" as const }, take: 1 },
    },
  },
  linkedWantedPost: {
    select: {
      id: true,
      title: true,
      category: true,
      status: true,
      budgetMinCents: true,
      budgetMaxCents: true,
    },
  },
} as const;

async function ensureTopicLinks(input: { linkedMarketItemId?: number | null; linkedWantedPostId?: number | null }) {
  if (input.linkedMarketItemId) {
    const item = await prisma.marketItem.findFirst({
      where: {
        id: input.linkedMarketItemId,
        visibility: "public",
        status: { in: ["active", "reserved", "sold", "withdrawn"] },
      },
      select: { id: true },
    });
    if (!item) throw Errors.badRequest("关联商品不存在或当前不可公开关联");
  }
  if (input.linkedWantedPostId) {
    const wanted = await prisma.wantedPost.findFirst({
      where: {
        id: input.linkedWantedPostId,
        status: { in: ["active", "responded", "matched", "completed", "cancelled", "expired"] },
      },
      select: { id: true },
    });
    if (!wanted) throw Errors.badRequest("关联求购不存在或当前不可公开关联");
  }
}

function contentRuleMessage(result: Awaited<ReturnType<typeof evaluateMarketContent>>) {
  const first = result.matches[0];
  return first?.note || "内容不符合社区发布规则，请修改后再试";
}

/**
 * 列表：?board=slug&page=1&size=20&sort=hot|new
 */
topicRouter.get("/", async (req, res, next) => {
  try {
    const boardSlug = req.query.board ? String(req.query.board) : undefined;
    const page = queryPage(req.query.page);
    const size = querySize(req.query.size, 20, 5, 50);
    const sort = String(req.query.sort ?? "new");
    const pinnedMode = req.query.pinned ? String(req.query.pinned) : "include";
    const requesterId = req.user?.userId ?? null;
    const requesterRole = req.user?.role ?? null;

    let boardId: number | undefined;
    if (boardSlug && boardSlug !== "all") {
      const b = await prisma.board.findUnique({ where: { slug: boardSlug } });
      if (!b) throw Errors.notFound("板块不存在");
      if (!isBoardTypeEnabled(b.type)) throw Errors.forbidden(featureClosedMessage(b.type));
      await ensureCanReadBoardType(b.type, requesterId, requesterRole);
      boardId = b.id;
    }

    if (!boardId) {
      const forumAccessEnabled = await resolveForumAccess(requesterId, requesterRole);
      if (!forumAccessEnabled) throw Errors.forbidden(requesterId ? "请先开启论坛功能并确认使用须知" : "请先登录并开启论坛功能");
    }

    const where: any = { hidden: false };
    if (boardId) where.boardId = boardId;
    else where.board = {
      type: { in: enabledBoardTypes() },
      section: { not: null },
      slug: { not: WEIWALL_BOARD_SLUG },
    };
    if (pinnedMode === "only") where.pinned = true;
    else if (pinnedMode === "exclude") where.pinned = false;

    const orderBy: any = pinnedMode === "only"
      ? [{ createdAt: "desc" }]
      : sort === "hot"
        ? [{ pinned: "desc" }, { likeCount: "desc" }, { lastReplyAt: "desc" }]
        : [{ pinned: "desc" }, { createdAt: "desc" }];

    const cached = await withCache(
      "forum-list",
      ["topic-list", boardSlug || "all", page, size, sort, pinnedMode],
      60_000,
      async () => {
        const [list, total] = await Promise.all([
          prisma.topic.findMany({
            where,
            orderBy,
            skip: (page - 1) * size,
            take: size,
            include: {
               author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
               board: { select: { id: true, slug: true, name: true, color: true, type: true } },
               tags: { include: { tag: true } },
               ...topicLinkInclude,
            },
          }),
          prisma.topic.count({ where }),
        ]);
        return { list, total };
      },
    );

    ok(res, {
      page,
      size,
      total: cached.total,
      list: cached.list.map((item: any) => decodeTopicForViewer(item, req.user)),
    });
  } catch (e) { next(e); }
});

topicRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await releaseExpiredMutes();
    const requesterId = req.user?.userId ?? null;
    const requesterRole = req.user?.role ?? "";
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, bio: true, status: true, mutedUntil: true } },
        board: { select: { id: true, slug: true, name: true, type: true, readOnly: true, anonymousEnabled: true } },
        tags: { include: { tag: true } },
        ...topicLinkInclude,
      },
    });
    if (!topic) throw Errors.notFound();
    const canSeeHidden = Boolean(requesterId && (requesterId === topic.authorId || requesterRole === "admin" || requesterRole === "mod"));
    if (topic.hidden && !canSeeHidden) throw Errors.notFound();
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    await ensureCanReadBoardType(topic.board?.type, requesterId, requesterRole);
    // 浏览数 +1（异步，失败也无所谓）
    if (!topic.hidden) prisma.topic.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
    ok(res, await decodeTopicForViewerWithImages(topic, req.user));
  } catch (e) { next(e); }
});

const createSchema = z.object({
  boardSlug: z.string().min(1),
  title: z.string().min(2).max(120),
  content: z.string().min(1).max(20000),
  metadata: z.record(z.any()).optional(),
  tags: z.array(z.string().max(20)).optional(),
  anonymous: z.boolean().optional(),
  linkedMarketItemId: z.number().int().positive().nullable().optional(),
  linkedWantedPostId: z.number().int().positive().nullable().optional(),
});

const formatSchema = z.object({
  title: z.string().max(120).optional(),
  content: z.string().min(1).max(20000),
  boardSlug: z.string().min(1).optional(),
  editorMode: z.enum(["visual", "markup"]).optional(),
});

topicRouter.post("/", authRequired, validate(createSchema), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { boardSlug, title, content, metadata, tags, anonymous = false, linkedMarketItemId, linkedWantedPostId } = req.body;
    await ensureForumAccessEnabled(userId, req.user!.role);
    await ensureUserCanSpeak(userId);
    await ensureUserCanSubmitTopic(userId);
    const board = await prisma.board.findUnique({ where: { slug: boardSlug } });
    if (!board) throw Errors.notFound("板块不存在");
    if (board.slug === WANTED_DEMAND_BOARD_SLUG) {
      throw Errors.badRequest("求购需求请使用结构化求购发布入口");
    }
    if (board.readOnly && req.user!.role !== "bot" && req.user!.role !== "admin") {
      throw Errors.forbidden("该板块为只读公告板，禁止发帖");
    }
    // 功能开关：admin 可一键关闭论坛或商城整块功能
    // type=announce 由系统/爬虫机器人发，不受用户开关约束
    if (board.type !== "announce" && req.user!.role !== "admin") {
      const featureKey = featureForBoardType(board.type) ?? "forum";
      if (!isFeatureOn(featureKey)) {
        throw Errors.forbidden("该板块当前不可发帖，已被站方临时关闭");
      }
    }
    if (anonymous && !board.anonymousEnabled) {
      throw Errors.forbidden("该板块暂不支持匿名发布");
    }
    await ensureTopicLinks({ linkedMarketItemId, linkedWantedPostId });
    const contentSafety = await evaluateMarketContent(prisma, [title, content], "forum");
    if (contentSafety.action !== "allow") throw Errors.badRequest(contentRuleMessage(contentSafety));

    const now = new Date();
    const bypassAiReview = await shouldBypassAiReviewForUser(userId, req.user!.role);
    const shouldReview = shouldRunAiReview() && !bypassAiReview;
    const aiResult = shouldReview
      ? await reviewTopicContent({
          title,
          content,
          boardName: board.name,
          boardType: board.type,
          metadata: metadata ?? {},
        })
      : null;
    const hiddenByAi = aiResult?.status === "blocked_ai";
    const manualLocked = aiResult?.riskLevel === "medium" || aiResult?.riskScore === undefined ? false : false;
    const anonymousAlias = anonymous ? createAnonymousAlias() : null;
    const topic = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "Board"
        WHERE "id" = ${board.id}
        FOR KEY SHARE
      `;
      const currentBoard = await tx.board.findUnique({
        where: { id: board.id },
        select: {
          slug: true,
          type: true,
          readOnly: true,
          anonymousEnabled: true,
        },
      });
      if (!currentBoard) throw Errors.notFound("板块不存在");
      if (
        currentBoard.slug !== board.slug
        || currentBoard.type !== board.type
        || currentBoard.readOnly !== board.readOnly
        || currentBoard.anonymousEnabled !== board.anonymousEnabled
      ) {
        throw Errors.conflict("板块配置已变化，请刷新后重新发布");
      }
      if (anonymous) {
        await consumeAnonymousCredit(userId, tx);
      }
      const created = await tx.topic.create({
        data: {
          boardId: board.id,
          authorId: userId,
          title,
          content,
          metadata: JSON.stringify(metadata ?? {}),
          aiReviewStatus: aiResult?.status ?? "auto_passed",
          aiRiskLevel: aiResult?.riskLevel ?? "low",
          aiRiskScore: aiResult?.riskScore ?? 0,
          aiReviewReason: aiResult?.reason ?? "",
          aiReviewDetail: aiResult?.detail ?? "",
          aiModel: aiResult?.model ?? null,
          aiReviewedAt: aiResult ? now : null,
          hidden: hiddenByAi,
          lastReplyAt: now,
          lastReplyById: userId,
          isAnonymous: anonymous,
           anonymousAlias,
           linkedMarketItemId: linkedMarketItemId || null,
           linkedWantedPostId: linkedWantedPostId || null,
        },
      });
      if (!hiddenByAi) {
        await tx.user.update({ where: { id: userId }, data: { postCount: { increment: 1 } } });
        await tx.board.update({ where: { id: board.id }, data: { topicCount: { increment: 1 } } });
      }
      return created;
    });

    if (tags?.length) {
      for (const name of tags) {
        const tag = await prisma.tag.upsert({
          where: { name },
          create: { name },
          update: {},
        });
        await prisma.topicTag.create({ data: { topicId: topic.id, tagId: tag.id } }).catch(() => {});
      }
    }

    const aiTags = await generateTopicAiTags({
      title,
      content,
      boardName: board.name,
      boardType: board.type,
      metadata: metadata ?? {},
    }).catch(() => [] as string[]);
    await syncTopicAiTags(topic.id, aiTags);

    const topicWithTags = await prisma.topic.findUnique({
      where: { id: topic.id },
      include: {
        board: { select: { slug: true, name: true, type: true, color: true } },
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
        tags: { include: { tag: true } },
        ...topicLinkInclude,
      },
    });

    if (hiddenByAi && aiResult) {
      await notifyTopicAiBlocked({
        topicId: topic.id,
        userId,
        title,
        reason: aiResult.reason,
        riskScore: aiResult.riskScore,
      });
    }

    await Promise.all([
      ensureForumImageAssetsForContent(content, userId).catch(() => null),
      ensureForumVideoAssetsForContent(content, userId).catch(() => null),
    ]);
    const imageReview = await summarizeForumImageModerationForContent(content).catch(() => null);
    const videoReview = await summarizeForumVideoModerationForContent(content).catch(() => null);
    await invalidateForumCaches();
    ok(res, {
      ...(await decodeTopicForViewerWithImages(topicWithTags ?? { ...topic, board: { slug: board.slug, name: board.name, type: board.type }, tags: [] }, req.user)),
      submissionResult: hiddenByAi
        ? {
            status: "blocked_ai",
            riskLevel: aiResult?.riskLevel,
            riskScore: aiResult?.riskScore,
            reason: aiResult?.reason,
            imageReview,
            videoReview,
          }
        : {
            status: "published",
            imageReview,
            videoReview,
          },
    });
  } catch (e) { next(e); }
});

topicRouter.post("/format", authRequired, validate(formatSchema), async (req, res, next) => {
  try {
    const { title, content, boardSlug, editorMode } = req.body;
    const board = boardSlug
      ? await prisma.board.findUnique({
          where: { slug: boardSlug },
          select: { name: true, type: true },
        })
      : null;
    const result = await autoFormatTopicContent({
      title,
      content,
      boardName: board?.name,
      boardType: board?.type,
      editorMode,
    });
    ok(res, result);
  } catch (e) { next(e); }
});

topicRouter.post("/:id/request-manual-review", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw Errors.badRequest("稿件 ID 不合法");
    await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    await requestManualTopicReview(id, req.user!.userId);
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

topicRouter.patch("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { type: true, slug: true } } },
    });
    if (!t) throw Errors.notFound();
    const isOwner = t.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    const canEditContent = isOwner || req.user!.role === "admin" || (req.user!.role === "mod" && t.board?.type !== "announce");
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));
    if (isOwner) await ensureForumAccessEnabled(req.user!.userId, req.user!.role);

    const body = req.body as any;
    if (t.board?.slug === WANTED_DEMAND_BOARD_SLUG && (body.title !== undefined || body.content !== undefined || body.metadata !== undefined)) {
      throw Errors.badRequest("求购需求请通过求购编辑页面修改");
    }
    const data: any = {};
    const nextTitle = typeof body.title === "string" && canEditContent ? body.title : t.title;
    const nextContent = typeof body.content === "string" && canEditContent ? body.content : t.content;
    const nextMetadataRaw = typeof body.metadata === "object" && body.metadata ? JSON.stringify(body.metadata) : t.metadata;
    if (typeof body.title === "string" && canEditContent) data.title = body.title;
    if (typeof body.content === "string" && canEditContent) data.content = body.content;
    if (typeof body.metadata === "object" && body.metadata && canEditContent) data.metadata = nextMetadataRaw;
    if (canEditContent && (body.linkedMarketItemId !== undefined || body.linkedWantedPostId !== undefined)) {
      const linkedMarketItemId = body.linkedMarketItemId === null ? null : Number(body.linkedMarketItemId);
      const linkedWantedPostId = body.linkedWantedPostId === null ? null : Number(body.linkedWantedPostId);
      if (body.linkedMarketItemId !== undefined && linkedMarketItemId !== null && (!Number.isSafeInteger(linkedMarketItemId) || linkedMarketItemId <= 0)) {
        throw Errors.badRequest("关联商品参数无效");
      }
      if (body.linkedWantedPostId !== undefined && linkedWantedPostId !== null && (!Number.isSafeInteger(linkedWantedPostId) || linkedWantedPostId <= 0)) {
        throw Errors.badRequest("关联求购参数无效");
      }
      await ensureTopicLinks({
        linkedMarketItemId: body.linkedMarketItemId === undefined ? undefined : linkedMarketItemId,
        linkedWantedPostId: body.linkedWantedPostId === undefined ? undefined : linkedWantedPostId,
      });
      if (body.linkedMarketItemId !== undefined) data.linkedMarketItemId = linkedMarketItemId;
      if (body.linkedWantedPostId !== undefined) data.linkedWantedPostId = linkedWantedPostId;
    }
    if (typeof body.pinned === "boolean" && isMod) data.pinned = body.pinned;
    if (typeof body.locked === "boolean" && isMod) data.locked = body.locked;
    if (typeof body.hidden === "boolean" && isMod) data.hidden = body.hidden;
    const wantsGlobalPinned = typeof body.globalPinned === "boolean" && isMod ? body.globalPinned : undefined;
    if (wantsGlobalPinned) {
      if (t.hidden || data.hidden === true) throw Errors.badRequest("隐藏帖子不能设为全局置顶");
      if (t.board?.type === "announce") throw Errors.badRequest("公告板帖子不能设为全局置顶");
    }

    if (isOwner && (typeof body.title === "string" || typeof body.content === "string")) {
      await ensureUserCanSpeak(req.user!.userId);
      const contentSafety = await evaluateMarketContent(prisma, [nextTitle, nextContent], "forum");
      if (contentSafety.action !== "allow") throw Errors.badRequest(contentRuleMessage(contentSafety));
      const similarityThreshold = getSiteConfig().aiEditSimilarityThreshold ?? 0;
      if (similarityThreshold > 0) {
        const similarity = await evaluateTopicEditSimilarity({
          originalTitle: t.title,
          originalContent: t.content,
          updatedTitle: nextTitle,
          updatedContent: nextContent,
        });
        if (similarity.similarity < similarityThreshold) {
          const reasonSuffix = similarity.reason ? `：${similarity.reason}` : "";
          throw Errors.badRequest(`修改后的内容与原内容相似度过低（${Math.round(similarity.similarity * 100)}%），未达到站点要求${reasonSuffix}`);
        }
      }
      const bypassAiReview = await shouldBypassAiReviewForUser(req.user!.userId, req.user!.role);
      const boardInfo = await prisma.board.findUnique({
        where: { id: t.boardId },
        select: { name: true, type: true },
      });
      if (shouldRunAiReview() && !bypassAiReview) {
        const aiResult = await reviewTopicContent({
          title: nextTitle,
          content: nextContent,
          boardName: boardInfo?.name,
          boardType: boardInfo?.type,
          metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : parseJsonSafe(t.metadata),
        });
        if (aiResult.status === "blocked_ai") {
          const imageReview = await summarizeForumImageModerationForContent(nextContent).catch(() => null);
          const videoReview = await summarizeForumVideoModerationForContent(nextContent).catch(() => null);
          return ok(res, {
            ...(await decodeTopicForViewerWithImages(t, req.user)),
            submissionResult: {
              status: "blocked_ai",
              riskLevel: aiResult.riskLevel,
              riskScore: aiResult.riskScore,
              reason: aiResult.reason,
              imageReview,
              videoReview,
            },
          });
        }
        data.aiReviewStatus = "auto_passed";
        data.aiRiskLevel = aiResult.riskLevel;
        data.aiRiskScore = aiResult.riskScore;
        data.aiReviewReason = aiResult.reason;
        data.aiReviewDetail = aiResult.detail;
        data.aiModel = aiResult.model;
        data.aiReviewedAt = new Date();
      }

      const aiTags = await generateTopicAiTags({
        title: nextTitle,
        content: nextContent,
        boardName: boardInfo?.name,
        boardType: boardInfo?.type,
        metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : parseJsonSafe(t.metadata),
      }).catch(() => [] as string[]);
      data.__aiTags = aiTags;
    }

    if (
      canEditContent &&
      Object.keys(data).length &&
      (
        (typeof body.title === "string" && body.title !== t.title) ||
        (typeof body.content === "string" && body.content !== t.content) ||
        (typeof body.metadata === "object" && body.metadata && nextMetadataRaw !== t.metadata)
      )
    ) {
      data.editCount = { increment: 1 };
    }

    const aiTags = Array.isArray(data.__aiTags) ? data.__aiTags : null;
    delete data.__aiTags;
    const hiddenChanged = typeof data.hidden === "boolean" && data.hidden !== t.hidden;
    const u = await prisma.$transaction(async (tx) => {
      const updated = await tx.topic.update({ where: { id }, data });
      if (hiddenChanged) {
        await Promise.all([
          refreshBoardTopicCounts([updated.boardId], tx),
          refreshUserPostCount(updated.authorId, tx),
        ]);
      }
      return updated;
    });
    if (wantsGlobalPinned !== undefined) {
      await setTopicGlobalPinned(id, wantsGlobalPinned);
    } else if (u.hidden) {
      await removeTopicFromGlobalPins(id);
    }
    if (aiTags) {
      await syncTopicAiTags(id, aiTags);
    }
    if (typeof body.content === "string" && canEditContent) {
      await Promise.all([
        ensureForumImageAssetsForContent(nextContent, req.user!.userId).catch(() => null),
        ensureForumVideoAssetsForContent(nextContent, req.user!.userId).catch(() => null),
      ]);
    }
    const imageReview = typeof body.content === "string" && canEditContent
      ? await summarizeForumImageModerationForContent(nextContent).catch(() => null)
      : null;
    const videoReview = typeof body.content === "string" && canEditContent
      ? await summarizeForumVideoModerationForContent(nextContent).catch(() => null)
      : null;
    const topicWithTags = await prisma.topic.findUnique({
      where: { id: u.id },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
        board: { select: { id: true, slug: true, name: true, color: true, type: true } },
        tags: { include: { tag: true } },
        ...topicLinkInclude,
      },
    });
    await invalidateForumCaches();
    ok(res, {
      ...(await decodeTopicForViewerWithImages(topicWithTags ?? u, req.user)),
      submissionResult: { status: "published", imageReview, videoReview },
    });
  } catch (e) { next(e); }
});

topicRouter.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { type: true, slug: true } } },
    });
    if (!t) throw Errors.notFound();
    if (t.board?.slug === WANTED_DEMAND_BOARD_SLUG) throw Errors.badRequest("求购需求请通过求购管理功能结束或移除");
    const isOwner = t.authorId === req.user!.userId;
    const isMod = req.user!.role === "mod" || req.user!.role === "admin";
    if (!isOwner && !isMod) throw Errors.forbidden();
    if (!isMod && !isBoardTypeEnabled(t.board?.type)) throw Errors.forbidden(featureClosedMessage(t.board?.type));
    if (isOwner) await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    await prisma.$transaction(async (tx) => {
      await tx.topic.update({ where: { id }, data: { hidden: true } });
      if (!t.hidden) {
        await Promise.all([
          refreshBoardTopicCounts([t.boardId], tx),
          refreshUserPostCount(t.authorId, tx),
        ]);
      }
    });
    await removeTopicFromGlobalPins(id);
    await invalidateForumCaches();
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

/** 帖子的回复列表 */
topicRouter.get("/:id/replies", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await releaseExpiredMutes();
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: { board: { select: { type: true } } },
    });
    if (!topic || topic.hidden) throw Errors.notFound("帖子不存在");
    if (!isBoardTypeEnabled(topic.board?.type)) throw Errors.forbidden(featureClosedMessage(topic.board?.type));
    await ensureCanReadBoardType(topic.board?.type, req.user?.userId ?? null, req.user?.role ?? null);
    const list = await prisma.reply.findMany({
      where: { topicId: id, hidden: false },
      orderBy: { floor: "asc" },
      include: {
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true } },
        weiwallMap: { select: { externalAuthorName: true, externalAuthorAvatar: true, externalAuthorUuid: true } },
      },
    });
    ok(res, await Promise.all(list.map((item) => decodeReplyForViewerWithImages(item, req.user))));
  } catch (e) { next(e); }
});
function parseJsonSafe(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
