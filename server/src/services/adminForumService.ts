import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { invalidateForumCaches } from "./cacheInvalidation";
import { decodeTopicForViewer } from "./forumPresentation";
import {
  refreshBoardTopicCounts,
  refreshCourseRatingAggregates,
  refreshTopicReplyStats,
  refreshUserPostCount,
  refreshUserReplyCount,
} from "./forumStats";
import { acquireForumTopicLock } from "./forumTopicLockService";
import {
  applyManualForumImageReview,
  listForumImageAssetsForContent,
} from "./imageModeration";
import {
  isGlobalPinnedTopic,
  mutateTopicGlobalPin,
  publishGlobalPinnedTopicIds,
} from "./siteSettings";
import {
  notifyManualReplyReviewDecision,
  notifyManualReviewDecision,
  refreshTopicSubmissionLock,
  resolveReplyManualReviewAdminNotifications,
  resolveTopicManualReviewAdminNotifications,
} from "./topicAiReview";
import { freezeAnonymousCredits } from "./userTrust";
import {
  applyManualForumVideoReview,
  listForumVideoAssetsForContent,
  listForumVideoQueue,
} from "./videoModeration";

export const adminTopicReviewStatusSchema = z.enum([
  "none",
  "checking",
  "auto_passed",
  "blocked_ai",
  "blocked_force",
  "manual_requested",
  "manual_reviewing",
  "approved_manual",
  "rejected_manual",
]);

const optionalBooleanQuery = z.enum(["0", "1"])
  .transform((value) => value === "1")
  .optional();

export const adminTopicListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  board: z.string().trim().min(1).max(64).optional(),
  hidden: optionalBooleanQuery,
  reviewStatus: adminTopicReviewStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  size: z.coerce.number().int().min(10).max(50).optional().default(20),
}).strict();

export const adminReviewTargetParamsSchema = z.object({
  kind: z.enum(["topic", "reply"]),
  id: z.coerce.number().int().positive().max(2_147_483_647),
}).strict();

export const adminTopicPatchSchema = z.object({
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  globalPinned: z.boolean().optional(),
  locked: z.boolean().optional(),
  boardSlug: z.string().trim().min(1).max(64).optional(),
  aiReviewStatus: z.enum([
    "manual_reviewing",
    "approved_manual",
    "rejected_manual",
  ]).optional(),
  manualReviewNote: z.string().trim().max(500).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
);

export const adminReplyPatchSchema = z.object({
  aiReviewStatus: z.enum([
    "manual_reviewing",
    "approved_manual",
    "rejected_manual",
  ]),
  manualReviewNote: z.string().trim().max(500).optional(),
}).strict();

export const adminForumMediaPatchSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  manualReviewNote: z.string().trim().max(500).optional(),
}).strict();

export const adminForumVideoListQuerySchema = z.object({
  status: z.enum([
    "pending",
    "manual_review",
    "rejected",
    "approved",
    "error",
  ]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  size: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict();

export const adminTopicDeleteQuerySchema = z.object({
  hard: z.enum(["0", "1", "false", "true"]).optional()
    .transform((value) => value === "1" || value === "true"),
}).strict();

export type AdminForumActor = {
  userId: number;
  role: string;
};
export type AdminTopicListQuery = z.infer<typeof adminTopicListQuerySchema>;
export type AdminReviewTargetParams = z.infer<typeof adminReviewTargetParamsSchema>;
export type AdminTopicPatch = z.infer<typeof adminTopicPatchSchema>;
export type AdminReplyPatch = z.infer<typeof adminReplyPatchSchema>;
export type AdminForumMediaPatch = z.infer<typeof adminForumMediaPatchSchema>;
export type AdminForumVideoListQuery = z.infer<typeof adminForumVideoListQuerySchema>;

function requireModerator(actor: AdminForumActor) {
  if (actor.role !== "admin" && actor.role !== "mod") {
    throw Errors.forbidden("仅论坛管理员或超级管理员可操作");
  }
}

function requireAdmin(actor: AdminForumActor) {
  if (actor.role !== "admin") {
    throw Errors.forbidden("仅超级管理员可操作");
  }
}

function isPendingManualReview(status: string) {
  return status === "manual_requested" || status === "manual_reviewing";
}

export async function listAdminTopics(
  actor: AdminForumActor,
  query: AdminTopicListQuery,
) {
  requireModerator(actor);
  const where: Prisma.TopicWhereInput = {};
  if (query.q) {
    where.OR = [
      { title: { contains: query.q } },
      { content: { contains: query.q } },
    ];
  }
  if (query.hidden !== undefined) where.hidden = query.hidden;
  if (query.reviewStatus) where.aiReviewStatus = query.reviewStatus;
  if (query.board) {
    const board = await prisma.board.findUnique({
      where: { slug: query.board },
      select: { id: true },
    });
    if (!board) throw Errors.notFound("板块不存在");
    where.boardId = board.id;
  }

  const [list, total] = await Promise.all([
    prisma.topic.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.size,
      take: query.size,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            nickname: true,
            role: true,
          },
        },
        board: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    }),
    prisma.topic.count({ where }),
  ]);
  return {
    page: query.page,
    size: query.size,
    total,
    list: list.map((topic) => decodeTopicForViewer(topic, actor)),
  };
}

export async function getAdminReviewTarget(
  actor: AdminForumActor,
  target: AdminReviewTargetParams,
) {
  requireModerator(actor);
  if (target.kind === "topic") {
    const topic = await prisma.topic.findUnique({
      where: { id: target.id },
      select: {
        id: true,
        title: true,
        aiReviewStatus: true,
        hidden: true,
      },
    });
    if (!topic) throw Errors.notFound("帖子不存在");
    return {
      kind: target.kind,
      id: topic.id,
      title: topic.title,
      aiReviewStatus: topic.aiReviewStatus,
      hidden: topic.hidden,
      reviewable: isPendingManualReview(topic.aiReviewStatus),
    };
  }

  const reply = await prisma.reply.findUnique({
    where: { id: target.id },
    select: {
      id: true,
      content: true,
      aiReviewStatus: true,
      hidden: true,
      topicId: true,
    },
  });
  if (!reply) throw Errors.notFound("回复不存在");
  return {
    kind: target.kind,
    id: reply.id,
    title: reply.content.slice(0, 80),
    aiReviewStatus: reply.aiReviewStatus,
    hidden: reply.hidden,
    topicId: reply.topicId,
    reviewable: isPendingManualReview(reply.aiReviewStatus),
  };
}

async function getReviewTargetContent(target: AdminReviewTargetParams) {
  if (target.kind === "topic") {
    const topic = await prisma.topic.findUnique({
      where: { id: target.id },
      select: { id: true, content: true },
    });
    if (!topic) throw Errors.notFound("帖子不存在");
    return { id: topic.id, content: topic.content };
  }
  const reply = await prisma.reply.findUnique({
    where: { id: target.id },
    select: { id: true, content: true, topicId: true },
  });
  if (!reply) throw Errors.notFound("回复不存在");
  return {
    id: reply.id,
    content: reply.content,
    topicId: reply.topicId,
  };
}

export async function listAdminReviewTargetImages(
  actor: AdminForumActor,
  target: AdminReviewTargetParams,
) {
  requireModerator(actor);
  const content = await getReviewTargetContent(target);
  return {
    kind: target.kind,
    id: content.id,
    ...("topicId" in content ? { topicId: content.topicId } : {}),
    list: await listForumImageAssetsForContent(content.content),
  };
}

export async function listAdminReviewTargetVideos(
  actor: AdminForumActor,
  target: AdminReviewTargetParams,
) {
  requireModerator(actor);
  const content = await getReviewTargetContent(target);
  return {
    kind: target.kind,
    id: content.id,
    ...("topicId" in content ? { topicId: content.topicId } : {}),
    list: await listForumVideoAssetsForContent(content.content),
  };
}

export async function updateAdminTopic(
  actor: AdminForumActor,
  topicId: number,
  patch: AdminTopicPatch,
) {
  requireModerator(actor);
  const result = await prisma.$transaction(async (tx) => {
    await acquireForumTopicLock(tx, topicId);
    const existing = await tx.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        authorId: true,
        boardId: true,
        title: true,
        hidden: true,
        isAnonymous: true,
        aiReviewStatus: true,
        board: { select: { type: true } },
      },
    });
    if (!existing) throw Errors.notFound("帖子不存在");

    let targetBoard: {
      id: number;
      slug: string;
      type: string;
      readOnly: boolean;
    } | null = null;
    if (patch.boardSlug) {
      targetBoard = await tx.board.findUnique({
        where: { slug: patch.boardSlug },
        select: { id: true, slug: true, type: true, readOnly: true },
      });
      if (!targetBoard) throw Errors.notFound("目标板块不存在");
    }
    const targetBoardId = targetBoard?.id ?? existing.boardId;
    await tx.$queryRaw`
      SELECT "id"
      FROM "Board"
      WHERE "id" IN (${existing.boardId}, ${targetBoardId})
      ORDER BY "id"
      FOR KEY SHARE
    `;
    const lockedBoards = await tx.board.findMany({
      where: { id: { in: [existing.boardId, targetBoardId] } },
      select: { id: true, slug: true, type: true, readOnly: true },
    });
    const sourceBoard = lockedBoards.find((board) => board.id === existing.boardId);
    if (!sourceBoard) throw Errors.notFound("原板块不存在");
    if (targetBoard) {
      const lockedTarget = lockedBoards.find((board) => board.id === targetBoard!.id);
      if (!lockedTarget || lockedTarget.slug !== patch.boardSlug) {
        throw Errors.conflict("目标板块配置已变化，请刷新后重试");
      }
      targetBoard = lockedTarget;
      if (targetBoard.readOnly) throw Errors.badRequest("不能转入只读板块");
      if (targetBoard.id !== existing.boardId) {
        const feedItemCount = await tx.schoolFeedItem.count({
          where: { topicId },
        });
        if (feedItemCount > 0) {
          throw Errors.badRequest("公告同步帖子不能转移板块");
        }
      }
    }

    const data: Prisma.TopicUncheckedUpdateInput = {};
    if (patch.hidden !== undefined) data.hidden = patch.hidden;
    if (patch.pinned !== undefined) data.pinned = patch.pinned;
    if (patch.locked !== undefined) data.locked = patch.locked;
    if (targetBoard) data.boardId = targetBoard.id;

    let reviewDecision: "approved_manual" | "rejected_manual" | null = null;
    if (patch.aiReviewStatus) {
      if (!isPendingManualReview(existing.aiReviewStatus)) {
        throw Errors.badRequest("该帖子当前不处于待人工审核状态");
      }
      data.aiReviewStatus = patch.aiReviewStatus;
      data.manualReviewedById = actor.userId;
      data.manualReviewedAt = new Date();
      data.manualReviewNote = patch.manualReviewNote ?? "";
      if (patch.aiReviewStatus === "approved_manual") {
        data.hidden = false;
        reviewDecision = patch.aiReviewStatus;
      } else if (patch.aiReviewStatus === "rejected_manual") {
        data.hidden = true;
        reviewDecision = patch.aiReviewStatus;
      }
    }

    const nextHidden = typeof data.hidden === "boolean"
      ? data.hidden
      : existing.hidden;
    const nextBoardType = targetBoard?.type ?? sourceBoard.type;
    if (patch.globalPinned === true && nextHidden) {
      throw Errors.badRequest("隐藏帖子不能设为全局置顶");
    }
    if (patch.globalPinned === true && nextBoardType === "announce") {
      throw Errors.badRequest("公告板帖子不能设为全局置顶");
    }

    const updated = await tx.topic.update({
      where: { id: topicId },
      data,
    });
    const hiddenChanged = updated.hidden !== existing.hidden;
    const boardChanged = updated.boardId !== existing.boardId;
    if (hiddenChanged || boardChanged) {
      await refreshBoardTopicCounts(
        [existing.boardId, updated.boardId],
        tx,
      );
      if (hiddenChanged) {
        await refreshUserPostCount(updated.authorId, tx);
      }
    }

    if (patch.aiReviewStatus) {
      await refreshTopicSubmissionLock(updated.authorId, tx);
      if (reviewDecision === "rejected_manual" && existing.isAnonymous) {
        await freezeAnonymousCredits(updated.authorId, tx);
      }
    }

    const mustRemoveGlobalPin = updated.hidden || nextBoardType === "announce";
    const nextGlobalPin = mustRemoveGlobalPin
      ? false
      : patch.globalPinned;
    const globalPinnedIds = nextGlobalPin === undefined
      ? null
      : await mutateTopicGlobalPin(tx, topicId, nextGlobalPin);
    return {
      existing,
      updated,
      globalPinnedIds,
      reviewDecision,
    };
  });

  if (result.globalPinnedIds) {
    await publishGlobalPinnedTopicIds(result.globalPinnedIds);
  }
  if (result.reviewDecision) {
    const approved = result.reviewDecision === "approved_manual";
    await Promise.all([
      notifyManualReviewDecision({
        topicId: result.updated.id,
        userId: result.updated.authorId,
        approved,
        title: result.updated.title,
        note: patch.manualReviewNote ?? "",
      }),
      resolveTopicManualReviewAdminNotifications({
        topicId: result.updated.id,
        approved,
        note: patch.manualReviewNote ?? "",
      }),
    ]);
  }
  await invalidateForumCaches({ includeCourses: true });
  return {
    id: result.updated.id,
    hidden: result.updated.hidden,
    pinned: result.updated.pinned,
    globalPinned: isGlobalPinnedTopic(result.updated.id),
    locked: result.updated.locked,
    boardId: result.updated.boardId,
    aiReviewStatus: result.updated.aiReviewStatus,
  };
}

export async function deleteAdminTopic(
  actor: AdminForumActor,
  topicId: number,
  hard: boolean,
) {
  requireModerator(actor);
  const result = await prisma.$transaction(async (tx) => {
    await acquireForumTopicLock(tx, topicId);
    const topic = await tx.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        boardId: true,
        hidden: true,
        authorId: true,
      },
    });
    if (!topic) throw Errors.notFound("帖子不存在");

    let deletedReplies = 0;
    let deletedRatings = 0;
    if (hard) {
      const [replyAuthors, ratings, replyCount] = await Promise.all([
        tx.reply.findMany({
          where: { topicId },
          distinct: ["authorId"],
          select: { authorId: true },
        }),
        tx.courseRating.findMany({
          where: { topicId },
          select: { courseId: true },
        }),
        tx.reply.count({ where: { topicId } }),
      ]);
      await tx.schoolFeedItem.deleteMany({ where: { topicId } });
      const ratingDelete = await tx.courseRating.deleteMany({
        where: { topicId },
      });
      await tx.topic.delete({ where: { id: topicId } });
      await refreshBoardTopicCounts([topic.boardId], tx);
      await refreshUserPostCount(topic.authorId, tx);
      for (const { authorId } of replyAuthors) {
        await refreshUserReplyCount(authorId, tx);
      }
      await refreshCourseRatingAggregates(
        ratings.map((rating) => rating.courseId),
        tx,
      );
      deletedReplies = replyCount;
      deletedRatings = ratingDelete.count;
    } else if (!topic.hidden) {
      await tx.topic.update({
        where: { id: topicId },
        data: { hidden: true },
      });
      await refreshBoardTopicCounts([topic.boardId], tx);
      await refreshUserPostCount(topic.authorId, tx);
    }

    const globalPinnedIds = await mutateTopicGlobalPin(tx, topicId, false);
    return {
      hard,
      deletedReplies,
      deletedRatings,
      globalPinnedIds,
    };
  });
  await publishGlobalPinnedTopicIds(result.globalPinnedIds);
  await invalidateForumCaches({ includeCourses: true });
  return {
    ok: true as const,
    hard: result.hard,
    deletedReplies: result.deletedReplies,
    deletedRatings: result.deletedRatings,
  };
}

export async function updateAdminReply(
  actor: AdminForumActor,
  replyId: number,
  patch: AdminReplyPatch,
) {
  requireModerator(actor);
  const initial = await prisma.reply.findUnique({
    where: { id: replyId },
    select: { topicId: true },
  });
  if (!initial) throw Errors.notFound("回复不存在");

  const updated = await prisma.$transaction(async (tx) => {
    await acquireForumTopicLock(tx, initial.topicId);
    const existing = await tx.reply.findUnique({
      where: { id: replyId },
      select: {
        id: true,
        topicId: true,
        authorId: true,
        content: true,
        hidden: true,
        floor: true,
        isAnonymous: true,
        aiReviewStatus: true,
      },
    });
    if (!existing) throw Errors.notFound("回复不存在");
    if (existing.topicId !== initial.topicId) {
      throw Errors.conflict("回复所属帖子已发生变化，请刷新后重试");
    }
    if (!isPendingManualReview(existing.aiReviewStatus)) {
      throw Errors.badRequest("该回复当前不处于待人工审核状态");
    }

    const data: Prisma.ReplyUncheckedUpdateInput = {
      aiReviewStatus: patch.aiReviewStatus,
      manualReviewedById: actor.userId,
      manualReviewNote: patch.manualReviewNote ?? "",
    };
    if (patch.aiReviewStatus !== "manual_reviewing") {
      data.manualReviewedAt = new Date();
    }
    if (patch.aiReviewStatus === "approved_manual") {
      data.hidden = false;
      if (existing.floor <= 0) {
        const last = await tx.reply.findFirst({
          where: { topicId: existing.topicId },
          orderBy: [{ floor: "desc" }, { id: "desc" }],
          select: { floor: true },
        });
        data.floor = Math.max(0, last?.floor ?? 0) + 1;
      }
    } else if (patch.aiReviewStatus === "rejected_manual") {
      data.hidden = true;
    }

    const reply = await tx.reply.update({
      where: { id: replyId },
      data,
      select: {
        id: true,
        topicId: true,
        authorId: true,
        content: true,
        hidden: true,
        floor: true,
        isAnonymous: true,
        aiReviewStatus: true,
        manualReviewedById: true,
        manualReviewedAt: true,
        manualReviewNote: true,
      },
    });
    if (reply.hidden !== existing.hidden) {
      await refreshTopicReplyStats(reply.topicId, tx);
      await refreshUserReplyCount(reply.authorId, tx);
    }
    if (
      patch.aiReviewStatus === "rejected_manual"
      && existing.isAnonymous
    ) {
      await freezeAnonymousCredits(reply.authorId, tx);
    }
    return reply;
  });

  if (
    patch.aiReviewStatus === "approved_manual"
    || patch.aiReviewStatus === "rejected_manual"
  ) {
    const approved = patch.aiReviewStatus === "approved_manual";
    await Promise.all([
      notifyManualReplyReviewDecision({
        replyId: updated.id,
        topicId: updated.topicId,
        userId: updated.authorId,
        approved,
        content: updated.content,
        note: patch.manualReviewNote ?? "",
      }),
      resolveReplyManualReviewAdminNotifications({
        replyId: updated.id,
        approved,
        note: patch.manualReviewNote ?? "",
      }),
    ]);
  }
  await invalidateForumCaches({ includeBoards: false });
  return {
    id: updated.id,
    topicId: updated.topicId,
    hidden: updated.hidden,
    floor: updated.floor,
    aiReviewStatus: updated.aiReviewStatus,
    manualReviewedById: updated.manualReviewedById,
    manualReviewedAt: updated.manualReviewedAt,
    manualReviewNote: updated.manualReviewNote,
  };
}

export async function reviewAdminForumImage(
  actor: AdminForumActor,
  assetId: number,
  patch: AdminForumMediaPatch,
) {
  requireModerator(actor);
  const updated = await applyManualForumImageReview({
    assetId,
    reviewerId: actor.userId,
    approved: patch.status === "approved",
    note: patch.manualReviewNote ?? "",
  });
  if (!updated) throw Errors.notFound("图片不存在");
  await invalidateForumCaches({ includeBoards: false });
  return updated;
}

export async function listAdminForumVideos(
  actor: AdminForumActor,
  query: AdminForumVideoListQuery,
) {
  requireAdmin(actor);
  return listForumVideoQueue(query);
}

export async function reviewAdminForumVideo(
  actor: AdminForumActor,
  assetId: number,
  patch: AdminForumMediaPatch,
) {
  requireModerator(actor);
  const updated = await applyManualForumVideoReview({
    assetId,
    reviewerId: actor.userId,
    approved: patch.status === "approved",
    note: patch.manualReviewNote ?? "",
  });
  if (!updated) throw Errors.notFound("视频不存在");
  await invalidateForumCaches({ includeBoards: false });
  return updated;
}
