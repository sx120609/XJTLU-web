import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { invalidateBoardCaches, invalidateForumCaches } from "./cacheInvalidation";
import {
  COMMUNITY_BOARD_DEFS,
  type CommunityBoardType,
  type ForumBoardSection,
} from "./defaultBoardCatalog";
import {
  resetSourceAndRun,
  runAllOnce,
  runOnce,
  withSchoolFeedSourceLock,
} from "./schoolCrawler";

export const adminBoardTypeSchema = z.enum([
  "normal",
  "question",
  "market",
  "coursereview",
]);
export const adminBoardSectionSchema = z.enum(["general", "study", "social"]);

const boardFieldsSchema = {
  slug: z.string().trim().min(2).max(40)
    .regex(/^[a-z0-9-]+$/, "slug 仅支持小写字母、数字和中划线"),
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(140).nullable().optional(),
  icon: z.string().trim().max(8).nullable().optional(),
  color: z.string().trim().max(20).nullable().optional(),
  order: z.number().int().min(0).max(9999).optional(),
  type: adminBoardTypeSchema,
  section: adminBoardSectionSchema.nullable().optional(),
  anonymousEnabled: z.boolean().optional(),
};

export const adminBoardCreateSchema = z.object(boardFieldsSchema).strict();

export const adminBoardPatchSchema = z.object({
  slug: boardFieldsSchema.slug.optional(),
  name: boardFieldsSchema.name.optional(),
  description: boardFieldsSchema.description,
  icon: boardFieldsSchema.icon,
  color: boardFieldsSchema.color,
  order: boardFieldsSchema.order,
  type: boardFieldsSchema.type.optional(),
  section: boardFieldsSchema.section,
  anonymousEnabled: boardFieldsSchema.anonymousEnabled,
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
);

export const adminFeedPatchSchema = z.object({
  enabled: z.boolean().optional(),
  cronMinutes: z.number().int().min(1).max(1440).optional(),
  maxPages: z.number().int().min(1).max(10).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
);

export type AdminBoardCreate = z.infer<typeof adminBoardCreateSchema>;
export type AdminBoardPatch = z.infer<typeof adminBoardPatchSchema>;
export type AdminFeedPatch = z.infer<typeof adminFeedPatchSchema>;
export type AdminBoardActor = {
  userId: number;
  role: string;
};

const systemBoardSlugs = new Set(
  COMMUNITY_BOARD_DEFS.map((board) => board.slug),
);

function requireAdmin(actor: AdminBoardActor) {
  if (actor.role !== "admin") {
    throw Errors.forbidden("仅超级管理员可操作");
  }
}

function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
}

function boardWriteConflict(error: unknown): never {
  if (prismaCode(error) === "P2002") {
    throw Errors.conflict("板块 slug 已存在");
  }
  throw error;
}

async function lockBoardRow(tx: Prisma.TransactionClient, boardId: number) {
  await tx.$queryRaw`
    SELECT "id"
    FROM "Board"
    WHERE "id" = ${boardId}
    FOR UPDATE
  `;
}

export function isSystemManagedBoardSlug(slug: string) {
  return systemBoardSlugs.has(slug);
}

function serializeAdminBoard<T extends { slug: string }>(board: T) {
  return {
    ...board,
    systemManaged: isSystemManagedBoardSlug(board.slug),
  };
}

function normalizeNullableText(value: string | null | undefined) {
  return value === undefined ? undefined : (value || null);
}

export async function listAdminBoards(actor: AdminBoardActor) {
  requireAdmin(actor);
  const list = await prisma.board.findMany({
    orderBy: [{ order: "asc" }, { id: "asc" }],
    include: {
      feedSource: { select: { id: true, name: true } },
    },
  });
  return list.map(serializeAdminBoard);
}

export async function createAdminBoard(
  actor: AdminBoardActor,
  input: AdminBoardCreate,
) {
  requireAdmin(actor);
  if (isSystemManagedBoardSlug(input.slug)) {
    throw Errors.conflict("该 slug 属于系统板块，不能重复创建");
  }
  try {
    const created = await prisma.board.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: normalizeNullableText(input.description),
        icon: normalizeNullableText(input.icon),
        color: normalizeNullableText(input.color),
        order: input.order ?? 0,
        type: input.type,
        section: input.section ?? null,
        anonymousEnabled: input.anonymousEnabled ?? false,
        readOnly: false,
      },
    });
    await invalidateBoardCaches();
    await invalidateForumCaches();
    return serializeAdminBoard(created);
  } catch (error) {
    boardWriteConflict(error);
  }
}

export async function updateAdminBoard(
  actor: AdminBoardActor,
  boardId: number,
  patch: AdminBoardPatch,
) {
  requireAdmin(actor);
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockBoardRow(tx, boardId);
      const current = await tx.board.findUnique({
        where: { id: boardId },
        include: { feedSource: { select: { id: true } } },
      });
      if (!current) throw Errors.notFound("板块不存在");
      if (isSystemManagedBoardSlug(current.slug)) {
        throw Errors.badRequest("系统板块由产品目录维护，不能在后台修改");
      }
      if (current.readOnly || current.feedSourceId || current.feedSource) {
        throw Errors.badRequest("公告同步板块请通过公告源配置维护");
      }
      if (
        patch.slug
        && patch.slug !== current.slug
        && isSystemManagedBoardSlug(patch.slug)
      ) {
        throw Errors.conflict("目标 slug 属于系统板块");
      }

      const board = await tx.board.update({
        where: { id: boardId },
        data: {
          slug: patch.slug,
          name: patch.name,
          description: normalizeNullableText(patch.description),
          icon: normalizeNullableText(patch.icon),
          color: normalizeNullableText(patch.color),
          order: patch.order,
          type: patch.type,
          section: patch.section,
          anonymousEnabled: patch.anonymousEnabled,
        },
      });
      return board;
    });
    await invalidateBoardCaches();
    await invalidateForumCaches();
    return serializeAdminBoard(updated);
  } catch (error) {
    boardWriteConflict(error);
  }
}

export async function deleteAdminBoard(
  actor: AdminBoardActor,
  boardId: number,
) {
  requireAdmin(actor);
  const deleted = await prisma.$transaction(async (tx) => {
    await lockBoardRow(tx, boardId);
    const board = await tx.board.findUnique({ where: { id: boardId } });
    if (!board) throw Errors.notFound("板块不存在");
    if (isSystemManagedBoardSlug(board.slug)) {
      throw Errors.badRequest("系统板块不能删除");
    }
    if (board.readOnly || board.feedSourceId) {
      throw Errors.badRequest("公告同步板块不能在这里删除");
    }

    const [
      topicCount,
      weiwallConfigCount,
    ] = await Promise.all([
      tx.topic.count({ where: { boardId } }),
      tx.weiwallSyncConfig.count({ where: { boardId } }),
    ]);
    if (topicCount > 0) {
      throw Errors.conflict(`该板块下仍有 ${topicCount} 篇帖子，不能删除`);
    }
    const references = [
      weiwallConfigCount > 0 ? `逛逛同步配置 ${weiwallConfigCount} 个` : "",
    ].filter(Boolean);
    if (references.length) {
      throw Errors.conflict(
        `该板块仍被引用：${references.join("、")}；请先修改相关配置`,
      );
    }
    await tx.board.delete({ where: { id: boardId } });
    return { ok: true as const, deletedBoardId: boardId };
  });
  await invalidateBoardCaches();
  await invalidateForumCaches();
  return deleted;
}

export async function listAdminFeedSources(actor: AdminBoardActor) {
  requireAdmin(actor);
  return prisma.schoolFeedSource.findMany({
    orderBy: { id: "asc" },
    include: {
      board: {
        select: {
          id: true,
          slug: true,
          name: true,
          topicCount: true,
        },
      },
    },
  });
}

export async function updateAdminFeedSource(
  actor: AdminBoardActor,
  sourceId: number,
  patch: AdminFeedPatch,
) {
  requireAdmin(actor);
  const locked = await withSchoolFeedSourceLock(sourceId, async () => {
    const source = await prisma.schoolFeedSource.findUnique({
      where: { id: sourceId },
      select: { id: true },
    });
    if (!source) throw Errors.notFound("公告源不存在");
    return prisma.schoolFeedSource.update({
      where: { id: sourceId },
      data: patch,
      include: {
        board: {
          select: {
            id: true,
            slug: true,
            name: true,
            topicCount: true,
          },
        },
      },
    });
  });
  if (!locked.acquired) {
    throw Errors.conflict("该公告源正在同步，请稍后再修改");
  }
  return locked.result!;
}

export async function runAdminFeedSource(
  actor: AdminBoardActor,
  sourceId: number,
) {
  requireAdmin(actor);
  const source = await prisma.schoolFeedSource.findUnique({
    where: { id: sourceId },
    select: { id: true },
  });
  if (!source) throw Errors.notFound("公告源不存在");
  const result = await runOnce(sourceId, { force: true });
  if (result.error === "source busy") {
    throw Errors.conflict("该公告源正在同步");
  }
  return result;
}

export async function resetAndRunAdminFeedSource(
  actor: AdminBoardActor,
  sourceId: number,
) {
  requireAdmin(actor);
  const source = await prisma.schoolFeedSource.findUnique({
    where: { id: sourceId },
    select: { id: true },
  });
  if (!source) throw Errors.notFound("公告源不存在");
  const result = await resetSourceAndRun(sourceId);
  if (result.error === "source busy") {
    throw Errors.conflict("该公告源正在同步");
  }
  return result;
}

export async function runAllAdminFeedSources(actor: AdminBoardActor) {
  requireAdmin(actor);
  return runAllOnce();
}

export type AdminBoardType = CommunityBoardType;
export type AdminBoardSection = ForumBoardSection;
