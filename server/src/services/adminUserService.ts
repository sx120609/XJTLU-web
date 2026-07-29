import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { hashPassword } from "../utils/password";
import { Errors } from "../utils/response";
import { parseMutedUntil, releaseExpiredMutes } from "./userModeration";
import {
  buildUserTrustSnapshot,
  currentAnonymousWeekKey,
} from "./userTrust";

export const adminUserRoleSchema = z.enum(["user", "mod", "admin", "bot"]);
export const adminUserStatusSchema = z.enum(["active", "banned", "muted"]);

const optionalBooleanQuery = z.enum(["0", "1"])
  .transform((value) => value === "1")
  .optional();

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  role: adminUserRoleSchema.optional(),
  status: adminUserStatusSchema.optional(),
  loginClient: z.enum(["all", "none", "ios", "android", "harmony", "web", "unknown"]).optional(),
  usedClient: z.enum(["ios", "android", "harmony"]).optional(),
  usedIosClient: optionalBooleanQuery,
  usedAndroidClient: optionalBooleanQuery,
  usedHarmonyClient: optionalBooleanQuery,
  forumEnabled: optionalBooleanQuery,
  loginFrom: z.string().date().optional(),
  loginTo: z.string().date().optional(),
  sort: z.enum(["login-desc", "id-desc", "id-asc"]).optional().default("login-desc"),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  size: z.coerce.number().int().min(10).max(100).optional().default(30),
}).strict();

export const adminUserPatchSchema = z.object({
  status: adminUserStatusSchema.optional(),
  role: adminUserRoleSchema.optional(),
  nickname: z.string().trim().min(1).max(20).optional(),
  aiReviewWhitelisted: z.boolean().optional(),
  mutedUntil: z.string().trim().max(64).nullable().optional(),
  anonymousCredits: z.number().int().min(0).max(999).optional(),
  anonymousCreditsFrozen: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
);

export const adminUserCreateSchema = z.object({
  username: z.string().trim().min(3).max(20)
    .regex(/^[a-zA-Z0-9_]+$/, "用户名仅允许英文、数字和下划线"),
  password: z.string().min(6).max(64),
  nickname: z.string().trim().min(1).max(20),
  role: adminUserRoleSchema.optional().default("user"),
  college: z.string().trim().max(40).optional(),
  enrollYear: z.number().int().min(2000).max(2100).optional(),
}).strict();

export const adminUserPasswordSchema = z.object({
  newPassword: z.string().min(6).max(64),
}).strict();

export type AdminUserActor = {
  userId: number;
  role: string;
};

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type AdminUserPatch = z.infer<typeof adminUserPatchSchema>;
export type AdminUserCreate = z.infer<typeof adminUserCreateSchema>;

export type ProtectedAdminUserDependencies = {
  feedSources: number;
  sponsorOrders: number;
  promotionOrders: number;
  marketOrders: number;
  marketRefunds: number;
  marketSettlements: number;
  marketReports: number;
  marketViolations: number;
  marketAppeals: number;
  learningMaterialVersions: number;
  learningMaterialSupportTickets: number;
  ownedItemWantedResponses: number;
};

const ADMIN_ROLE_INVARIANT_LOCK_KEY = 1_205_040n * 4_294_967_296n + 1n;

const adminUserSelect = {
  id: true,
  username: true,
  nickname: true,
  email: true,
  avatar: true,
  college: true,
  enrollYear: true,
  role: true,
  studentSso: true,
  status: true,
  mutedUntil: true,
  postCount: true,
  replyCount: true,
  reputation: true,
  forumEnabled: true,
  forumEnabledAt: true,
  anonymousCredits: true,
  anonymousWeekKey: true,
  anonymousCreditsFrozen: true,
  aiReviewWhitelisted: true,
  lastSeenAt: true,
  lastLoginAt: true,
  lastLoginClient: true,
  usedIosClient: true,
  usedAndroidClient: true,
  usedHarmonyClient: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type AdminUserTransaction = Prisma.TransactionClient;

function requireModerator(actor: AdminUserActor) {
  if (actor.role !== "admin" && actor.role !== "mod") {
    throw Errors.forbidden("仅论坛管理员或超级管理员可操作");
  }
}

function requireAdmin(actor: AdminUserActor) {
  if (actor.role !== "admin") {
    throw Errors.forbidden("仅超级管理员可操作");
  }
}

async function acquireAdminRoleInvariantLock(tx: AdminUserTransaction) {
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${ADMIN_ROLE_INVARIANT_LOCK_KEY})
  `;
}

async function acquireAdminUserLock(tx: AdminUserTransaction, userId: number) {
  await tx.$queryRaw`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;
}

function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
}

function dateAtStartOfDay(value: string) {
  return new Date(`${value}T00:00:00`);
}

function dateAtEndOfDay(value: string) {
  return new Date(`${value}T23:59:59.999`);
}

export function assertAdminUserPatchAllowed(
  actor: AdminUserActor,
  target: { id: number; role: string },
  patch: AdminUserPatch,
) {
  requireModerator(actor);

  if (actor.role === "mod") {
    if (target.role !== "user") {
      throw Errors.forbidden("论坛管理员只能管理普通用户");
    }
    if (
      patch.role !== undefined
      || patch.aiReviewWhitelisted !== undefined
      || patch.anonymousCredits !== undefined
      || patch.anonymousCreditsFrozen !== undefined
    ) {
      throw Errors.forbidden("仅超级管理员可修改角色、AI 白名单或匿名额度");
    }
  }

  if (target.id === actor.userId) {
    if (patch.role !== undefined && patch.role !== target.role) {
      throw Errors.badRequest("不能修改自己的管理员角色");
    }
    if (patch.status !== undefined && patch.status !== "active") {
      throw Errors.badRequest("不能封禁或禁言当前登录账号");
    }
  }
}

export function adminUserPatchRemovesUsableAdmin(
  target: { role: string; status: string },
  patch: AdminUserPatch,
) {
  if (target.role !== "admin" || target.status === "banned") return false;
  const nextRole = patch.role ?? target.role;
  const nextStatus = patch.status ?? target.status;
  return nextRole !== "admin" || nextStatus === "banned";
}

export function protectedAdminUserDependencyLabels(
  dependencies: ProtectedAdminUserDependencies,
) {
  const labels: string[] = [];
  if (dependencies.feedSources) labels.push(`公告抓取源 ${dependencies.feedSources} 个`);
  if (dependencies.sponsorOrders) labels.push(`赞助订单 ${dependencies.sponsorOrders} 笔`);
  if (dependencies.promotionOrders) labels.push(`推广订单 ${dependencies.promotionOrders} 笔`);
  if (dependencies.marketOrders) labels.push(`市集订单 ${dependencies.marketOrders} 笔`);
  if (dependencies.marketRefunds) labels.push(`市集退款 ${dependencies.marketRefunds} 笔`);
  if (dependencies.marketSettlements) labels.push(`市集结算 ${dependencies.marketSettlements} 笔`);
  if (dependencies.marketReports) labels.push(`市集举报 ${dependencies.marketReports} 条`);
  if (dependencies.marketViolations) labels.push(`市集违规记录 ${dependencies.marketViolations} 条`);
  if (dependencies.marketAppeals) labels.push(`市集申诉 ${dependencies.marketAppeals} 条`);
  if (dependencies.learningMaterialVersions) {
    labels.push(`学习资料版本 ${dependencies.learningMaterialVersions} 个`);
  }
  if (dependencies.learningMaterialSupportTickets) {
    labels.push(`学习资料售后单 ${dependencies.learningMaterialSupportTickets} 个`);
  }
  if (dependencies.ownedItemWantedResponses) {
    labels.push(`商品关联求购响应 ${dependencies.ownedItemWantedResponses} 个`);
  }
  return labels;
}

async function protectedAdminUserDependencies(
  tx: AdminUserTransaction,
  userId: number,
): Promise<ProtectedAdminUserDependencies> {
  const [
    feedSources,
    sponsorOrders,
    promotionOrders,
    marketOrders,
    marketRefunds,
    marketSettlements,
    marketReports,
    marketViolations,
    marketAppeals,
    learningMaterialVersions,
    learningMaterialSupportTickets,
    ownedItemWantedResponses,
  ] = await Promise.all([
    tx.schoolFeedSource.count({ where: { botUserId: userId } }),
    tx.sponsorOrder.count({ where: { userId } }),
    tx.promotionOrder.count({ where: { userId } }),
    tx.marketOrder.count({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    }),
    tx.marketRefund.count({ where: { requestedById: userId } }),
    tx.marketSettlement.count({ where: { sellerId: userId } }),
    tx.marketReport.count({
      where: {
        OR: [
          { reporterId: userId },
          { reportedUserId: userId },
        ],
      },
    }),
    tx.marketViolation.count({ where: { userId } }),
    tx.marketAppeal.count({ where: { userId } }),
    tx.learningMaterialVersion.count({ where: { createdById: userId } }),
    tx.learningMaterialSupportTicket.count({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    }),
    tx.wantedResponse.count({
      where: { item: { sellerId: userId } },
    }),
  ]);
  return {
    feedSources,
    sponsorOrders,
    promotionOrders,
    marketOrders,
    marketRefunds,
    marketSettlements,
    marketReports,
    marketViolations,
    marketAppeals,
    learningMaterialVersions,
    learningMaterialSupportTickets,
    ownedItemWantedResponses,
  };
}

export async function listAdminUsers(
  actor: AdminUserActor,
  query: AdminUserListQuery,
) {
  requireModerator(actor);
  await releaseExpiredMutes();

  const where: Prisma.UserWhereInput = {};
  if (query.q) {
    where.OR = [
      { username: { contains: query.q, mode: "insensitive" } },
      { nickname: { contains: query.q, mode: "insensitive" } },
      { email: { contains: query.q, mode: "insensitive" } },
    ];
  }
  if (query.role) where.role = query.role;
  if (query.status) where.status = query.status;
  if (query.loginClient && query.loginClient !== "all") {
    if (query.loginClient === "none") where.lastLoginAt = null;
    else where.lastLoginClient = query.loginClient;
  }
  if (query.usedClient === "ios") where.usedIosClient = true;
  if (query.usedClient === "android") where.usedAndroidClient = true;
  if (query.usedClient === "harmony") where.usedHarmonyClient = true;
  if (query.usedIosClient !== undefined) where.usedIosClient = query.usedIosClient;
  if (query.usedAndroidClient !== undefined) where.usedAndroidClient = query.usedAndroidClient;
  if (query.usedHarmonyClient !== undefined) where.usedHarmonyClient = query.usedHarmonyClient;
  if (query.forumEnabled !== undefined) where.forumEnabled = query.forumEnabled;
  if (query.loginFrom || query.loginTo) {
    where.lastLoginAt = {
      ...(query.loginFrom ? { gte: dateAtStartOfDay(query.loginFrom) } : {}),
      ...(query.loginTo ? { lte: dateAtEndOfDay(query.loginTo) } : {}),
    };
  }

  const orderBy: Prisma.UserOrderByWithRelationInput[] = query.sort === "id-asc"
    ? [{ id: "asc" }]
    : query.sort === "id-desc"
      ? [{ id: "desc" }]
      : [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];

  const [list, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.size,
      take: query.size,
      select: adminUserSelect,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    page: query.page,
    size: query.size,
    total,
    list: list.map((user) => {
      const trust = buildUserTrustSnapshot(user);
      return {
        ...user,
        reputation: trust.reputation,
        reputationLevel: trust.reputationLevel,
        reputationBreakdown: trust.reputationBreakdown,
        anonymousState: trust.anonymousState,
      };
    }),
  };
}

export async function updateAdminUser(
  actor: AdminUserActor,
  userId: number,
  patch: AdminUserPatch,
) {
  return prisma.$transaction(async (tx) => {
    if (patch.role !== undefined || patch.status !== undefined) {
      await acquireAdminRoleInvariantLock(tx);
    }
    await acquireAdminUserLock(tx, userId);

    const current = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
        mutedUntil: true,
        createdAt: true,
        postCount: true,
        replyCount: true,
        forumEnabled: true,
        forumEnabledAt: true,
        anonymousCredits: true,
        anonymousWeekKey: true,
        anonymousCreditsFrozen: true,
      },
    });
    if (!current) throw Errors.notFound("用户不存在");
    assertAdminUserPatchAllowed(actor, current, patch);

    if (adminUserPatchRemovesUsableAdmin(current, patch)) {
      const usableAdminCount = await tx.user.count({
        where: {
          role: "admin",
          status: { not: "banned" },
        },
      });
      if (usableAdminCount <= 1) {
        throw Errors.conflict("不能移除或封禁最后一个可用的超级管理员");
      }
    }

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.nickname !== undefined) data.nickname = patch.nickname;
    if (patch.aiReviewWhitelisted !== undefined) {
      data.aiReviewWhitelisted = patch.aiReviewWhitelisted;
    }
    if (patch.anonymousCredits !== undefined) {
      data.anonymousCredits = patch.anonymousCredits;
      data.anonymousWeekKey = currentAnonymousWeekKey();
    }
    if (patch.anonymousCreditsFrozen !== undefined) {
      data.anonymousCreditsFrozen = patch.anonymousCreditsFrozen;
      if (patch.anonymousCreditsFrozen) data.anonymousCredits = 0;
    }

    const parsedMutedUntil = parseMutedUntil(patch.mutedUntil);
    if (patch.status !== undefined || patch.mutedUntil !== undefined) {
      const nextStatus = patch.status ?? current.status;
      const nextMutedUntil = parsedMutedUntil !== undefined
        ? parsedMutedUntil
        : current.mutedUntil;
      if (nextStatus === "muted") {
        if (nextMutedUntil && nextMutedUntil.getTime() <= Date.now()) {
          throw Errors.badRequest("禁言截止时间必须晚于当前时间");
        }
        data.status = "muted";
        data.mutedUntil = nextMutedUntil ?? null;
      } else {
        data.status = nextStatus;
        data.mutedUntil = null;
      }
      if (nextStatus === "muted" || nextStatus === "banned") {
        data.anonymousCreditsFrozen = true;
        data.anonymousCredits = 0;
      }
    }

    const user = await tx.user.update({ where: { id: userId }, data });
    const trust = buildUserTrustSnapshot(user);
    return {
      id: user.id,
      role: user.role,
      status: user.status,
      mutedUntil: user.mutedUntil,
      nickname: user.nickname,
      aiReviewWhitelisted: user.aiReviewWhitelisted,
      anonymousCredits: user.anonymousCredits,
      anonymousCreditsFrozen: user.anonymousCreditsFrozen,
      anonymousState: trust.anonymousState,
      reputation: trust.reputation,
      reputationLevel: trust.reputationLevel,
    };
  });
}

export async function createAdminUser(
  actor: AdminUserActor,
  input: AdminUserCreate,
) {
  requireAdmin(actor);
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: input.username,
          passwordHash,
          nickname: input.nickname,
          role: input.role,
          college: input.college || undefined,
          enrollYear: input.enrollYear,
        },
      });
      await tx.messageSetting.create({ data: { userId: user.id } });
      return {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        college: user.college,
        enrollYear: user.enrollYear,
        createdAt: user.createdAt,
      };
    });
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      throw Errors.conflict("该用户名已被占用");
    }
    throw error;
  }
}

export async function resetAdminUserPassword(
  actor: AdminUserActor,
  userId: number,
  newPassword: string,
) {
  requireAdmin(actor);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await acquireAdminUserLock(tx, userId);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, studentSso: true },
    });
    if (!target) throw Errors.notFound("用户不存在");
    if (target.studentSso) {
      throw Errors.badRequest("该账号使用学校认证，没有可重置的站内密码");
    }
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  });
  return { ok: true as const };
}

export async function deleteAdminUser(
  actor: AdminUserActor,
  userId: number,
) {
  requireAdmin(actor);
  if (userId === actor.userId) {
    throw Errors.badRequest("不能删除当前登录账号");
  }

  return prisma.$transaction(async (tx) => {
    await acquireAdminRoleInvariantLock(tx);
    await acquireAdminUserLock(tx, userId);

    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target) throw Errors.notFound("用户不存在");
    if (target.role === "admin") {
      const usableAdminCount = await tx.user.count({
        where: {
          role: "admin",
          status: { not: "banned" },
        },
      });
      if (target.role === "admin" && usableAdminCount <= 1) {
        throw Errors.conflict("不能删除最后一个可用的超级管理员");
      }
    }

    const dependencies = await protectedAdminUserDependencies(tx, userId);
    const dependencyLabels = protectedAdminUserDependencyLabels(dependencies);
    if (dependencyLabels.length) {
      throw Errors.conflict(
        `该账号仍关联需保留的业务记录：${dependencyLabels.join("、")}；请先完成交接或保留账号并封禁`,
      );
    }

    const topics = await tx.topic.findMany({
      where: { authorId: userId },
      select: { id: true, boardId: true },
    });
    const topicIds = topics.map((topic) => topic.id);
    const boardIds = [...new Set(topics.map((topic) => topic.boardId))];

    const ratings = await tx.courseRating.findMany({
      where: topicIds.length
        ? { OR: [{ authorId: userId }, { topicId: { in: topicIds } }] }
        : { authorId: userId },
      select: { courseId: true },
    });
    const affectedCourseIds = [...new Set(ratings.map((rating) => rating.courseId))];

    const replies = await tx.reply.findMany({
      where: { authorId: userId },
      select: { id: true, topicId: true },
    });
    const replyIds = replies.map((reply) => reply.id);
    const affectedTopicIds = [...new Set(
      replies
        .map((reply) => reply.topicId)
        .filter((topicId) => !topicIds.includes(topicId)),
    )];

    const affectedReplyAuthors = topicIds.length
      ? await tx.reply.findMany({
        where: {
          topicId: { in: topicIds },
          authorId: { not: userId },
        },
        distinct: ["authorId"],
        select: { authorId: true },
      })
      : [];

    if (replyIds.length) {
      await tx.reply.updateMany({
        where: { parentReplyId: { in: replyIds } },
        data: { parentReplyId: null },
      });
    }

    await tx.courseRating.deleteMany({
      where: topicIds.length
        ? { OR: [{ authorId: userId }, { topicId: { in: topicIds } }] }
        : { authorId: userId },
    });
    if (topicIds.length) {
      await tx.schoolFeedItem.deleteMany({ where: { topicId: { in: topicIds } } });
    }
    if (replyIds.length) {
      await tx.reply.deleteMany({ where: { id: { in: replyIds } } });
    }
    if (topicIds.length) {
      await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
    }

    for (const topicId of affectedTopicIds) {
      const [replyCount, lastReply] = await Promise.all([
        tx.reply.count({ where: { topicId, hidden: false } }),
        tx.reply.findFirst({
          where: { topicId, hidden: false },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, authorId: true },
        }),
      ]);
      await tx.topic.updateMany({
        where: { id: topicId },
        data: {
          replyCount,
          lastReplyAt: lastReply?.createdAt ?? null,
          lastReplyById: lastReply?.authorId ?? null,
        },
      });
    }

    for (const boardId of boardIds) {
      const topicCount = await tx.topic.count({
        where: { boardId, hidden: false },
      });
      await tx.board.updateMany({
        where: { id: boardId },
        data: { topicCount },
      });
    }

    for (const { authorId } of affectedReplyAuthors) {
      const replyCount = await tx.reply.count({
        where: { authorId, hidden: false },
      });
      await tx.user.updateMany({
        where: { id: authorId },
        data: { replyCount },
      });
    }

    for (const courseId of affectedCourseIds) {
      const aggregate = await tx.courseRating.aggregate({
        where: { courseId },
        _count: true,
        _avg: {
          difficulty: true,
          reward: true,
          recommend: true,
          givingScore: true,
        },
      });
      await tx.course.updateMany({
        where: { id: courseId },
        data: {
          ratingCount: aggregate._count,
          avgDifficulty: aggregate._avg.difficulty ?? 0,
          avgReward: aggregate._avg.reward ?? 0,
          avgRecommend: aggregate._avg.recommend ?? 0,
          avgScore: aggregate._avg.givingScore ?? 0,
        },
      });
    }

    await tx.user.delete({ where: { id: userId } });
    return {
      deletedUserId: userId,
      deletedTopics: topicIds.length,
      deletedReplies: replyIds.length,
    };
  });
}
