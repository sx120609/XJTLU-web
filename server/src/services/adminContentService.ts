import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import {
  normalizeNotificationTargetClient,
  NOTIFICATION_TARGET_CLIENTS,
} from "./notificationTargeting";
import {
  createWeiwallTokenAuthSession,
  getWeiwallSyncAdminConfig,
  getWeiwallTokenAuthStatus,
  runWeiwallSyncNow,
  updateWeiwallSyncConfig,
  type WeiwallSyncPatch,
} from "./weiwallSync";
import {
  authorizeXjtluAnnouncementSync,
  clearXjtluAnnouncementSyncAuthorization,
  getXjtluAnnouncementSyncStatus,
  syncXjtluAnnouncementsNow,
  updateXjtluAnnouncementSyncConfig,
} from "./xjtluAnnouncementSync";

export type AdminContentActor = {
  userId: number;
  role: string;
};

function requireAdmin(actor: AdminContentActor) {
  if (actor.role !== "admin") {
    throw Errors.forbidden("仅超级管理员可操作");
  }
}

const httpsBaseUrlSchema = z.string().trim().max(240).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "必须是有效的 HTTPS 地址");

export const adminWeiwallPatchSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: httpsBaseUrlSchema.optional(),
  schoolEn: z.string().trim().min(1).max(40).optional(),
  tenantId: z.number().int().min(1).max(999999).optional(),
  token: z.string().trim().min(1).max(4000).optional(),
  clearToken: z.boolean().optional(),
  intervalSeconds: z.number().int().min(30).max(3600).optional(),
  topicPages: z.number().int().min(1).max(20).optional(),
  commentPageSize: z.number().int().min(5).max(20).optional(),
  maxCommentPages: z.number().int().min(1).max(50).optional(),
  maxReplyPages: z.number().int().min(1).max(50).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
).refine(
  (value) => !(value.clearToken && value.token),
  "不能同时设置并清空 Token",
);

export const adminWeiwallAuthLinkSchema = z.object({
  origin: z.string().trim().url().max(240).optional(),
}).strict();

export const adminWeiwallAuthStatusParamsSchema = z.object({
  flowId: z.string().uuid(),
}).strict();

export const adminAnnouncementSyncPatchSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).max(1440).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
);

const announcementTargetClientSchema = z.union([
  z.enum(["all", ...NOTIFICATION_TARGET_CLIENTS]),
  z.array(z.enum(NOTIFICATION_TARGET_CLIENTS)).min(1).max(
    NOTIFICATION_TARGET_CLIENTS.length,
  ),
]);

export function isSafeAnnouncementLink(input: string) {
  const value = input.trim();
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

const announcementLinkSchema = z.string().trim().max(500).refine(
  isSafeAnnouncementLink,
  "公告链接必须是站内路径或 HTTP(S) 地址",
);

export const adminAnnouncementCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  content: z.string().trim().min(1).max(2000),
  level: z.enum(["strong", "normal", "weak"]).optional(),
  link: announcementLinkSchema.optional(),
  source: z.string().trim().max(40).optional(),
  targetClient: announcementTargetClientSchema.optional(),
}).strict();

export const adminAnnouncementPatchSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  content: z.string().trim().min(1).max(2000).optional(),
  level: z.enum(["strong", "normal", "weak"]).optional(),
  link: announcementLinkSchema.nullable().optional(),
  source: z.string().trim().max(40).nullable().optional(),
  targetClient: announcementTargetClientSchema.optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
);

export type AdminAnnouncementCreate = z.infer<
  typeof adminAnnouncementCreateSchema
>;
export type AdminAnnouncementPatch = z.infer<
  typeof adminAnnouncementPatchSchema
>;

export async function getAdminWeiwallSync(actor: AdminContentActor) {
  requireAdmin(actor);
  return getWeiwallSyncAdminConfig();
}

export async function updateAdminWeiwallSync(
  actor: AdminContentActor,
  patch: WeiwallSyncPatch,
) {
  requireAdmin(actor);
  return updateWeiwallSyncConfig(patch);
}

export async function runAdminWeiwallSync(actor: AdminContentActor) {
  requireAdmin(actor);
  const result = await runWeiwallSyncNow();
  if (result.error === "locked") {
    throw Errors.conflict("逛逛同步任务正在运行");
  }
  return result;
}

export async function createAdminWeiwallAuthSession(
  actor: AdminContentActor,
  origin: string,
) {
  requireAdmin(actor);
  return createWeiwallTokenAuthSession(origin);
}

export async function getAdminWeiwallAuthStatus(
  actor: AdminContentActor,
  flowId: string,
) {
  requireAdmin(actor);
  return getWeiwallTokenAuthStatus(flowId);
}

export async function getAdminAnnouncementSync(actor: AdminContentActor) {
  requireAdmin(actor);
  return getXjtluAnnouncementSyncStatus();
}

export async function authorizeAdminAnnouncementSync(
  actor: AdminContentActor,
) {
  requireAdmin(actor);
  return authorizeXjtluAnnouncementSync(actor.userId);
}

export async function updateAdminAnnouncementSync(
  actor: AdminContentActor,
  patch: { enabled?: boolean; intervalMinutes?: number },
) {
  requireAdmin(actor);
  return updateXjtluAnnouncementSyncConfig(patch);
}

export async function runAdminAnnouncementSync(actor: AdminContentActor) {
  requireAdmin(actor);
  const result = await syncXjtluAnnouncementsNow();
  if (result.skipped) {
    throw Errors.conflict("公告同步任务正在运行");
  }
  return {
    ...result,
    status: await getXjtluAnnouncementSyncStatus(),
  };
}

export async function clearAdminAnnouncementSync(
  actor: AdminContentActor,
) {
  requireAdmin(actor);
  return clearXjtluAnnouncementSyncAuthorization();
}

export async function listAdminAnnouncements(actor: AdminContentActor) {
  requireAdmin(actor);
  return prisma.notification.findMany({
    where: { userId: null, category: "system" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

function normalizeAnnouncementLink(input: string | null | undefined) {
  if (input === undefined) return undefined;
  return input?.trim() || null;
}

async function lockNotificationRow(
  tx: Prisma.TransactionClient,
  notificationId: number,
) {
  await tx.$queryRaw`
    SELECT "id"
    FROM "Notification"
    WHERE "id" = ${notificationId}
    FOR UPDATE
  `;
}

function assertSystemAnnouncement(
  notification: { userId: number | null; category: string } | null,
) {
  if (!notification) throw Errors.notFound("公告不存在");
  if (notification.userId !== null || notification.category !== "system") {
    throw Errors.badRequest("只能操作全站站务公告");
  }
}

export async function createAdminAnnouncement(
  actor: AdminContentActor,
  input: AdminAnnouncementCreate,
) {
  requireAdmin(actor);
  return prisma.notification.create({
    data: {
      userId: null,
      category: "system",
      targetClient: normalizeNotificationTargetClient(input.targetClient),
      level: input.level ?? "normal",
      title: input.title,
      content: input.content,
      link: normalizeAnnouncementLink(input.link),
      source: input.source || "站务组",
    },
  });
}

export async function updateAdminAnnouncement(
  actor: AdminContentActor,
  notificationId: number,
  patch: AdminAnnouncementPatch,
) {
  requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    await lockNotificationRow(tx, notificationId);
    const existing = await tx.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true, category: true },
    });
    assertSystemAnnouncement(existing);
    return tx.notification.update({
      where: { id: notificationId },
      data: {
        title: patch.title,
        content: patch.content,
        level: patch.level,
        link: normalizeAnnouncementLink(patch.link),
        source: patch.source === undefined
          ? undefined
          : patch.source || "站务组",
        targetClient: patch.targetClient === undefined
          ? undefined
          : normalizeNotificationTargetClient(patch.targetClient),
      },
    });
  });
}

export async function deleteAdminAnnouncement(
  actor: AdminContentActor,
  notificationId: number,
) {
  requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    await lockNotificationRow(tx, notificationId);
    const existing = await tx.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true, category: true },
    });
    assertSystemAnnouncement(existing);
    await tx.notification.delete({ where: { id: notificationId } });
    return { ok: true as const };
  });
}
