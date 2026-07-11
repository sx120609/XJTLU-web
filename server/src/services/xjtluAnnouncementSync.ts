import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { runWithDistributedLock } from "./cache";
import {
  exportXjtluEhallSession,
  getXjtluEhallNoticesFromEncryptedSession,
} from "./xjtluEhallClient";

const CONFIG_ID = 1;
const DEFAULT_INTERVAL_MINUTES = 15;

async function ensureConfig() {
  return prisma.xjtluAnnouncementSyncConfig.upsert({
    where: { id: CONFIG_ID },
    update: {},
    create: { id: CONFIG_ID, intervalMinutes: DEFAULT_INTERVAL_MINUTES },
  });
}

export async function getXjtluAnnouncementSyncStatus() {
  const config = await ensureConfig();
  const count = await prisma.xjtluAnnouncement.count();
  return {
    enabled: config.enabled,
    authorized: Boolean(config.sourceUserId && config.encryptedSession),
    sourceUserId: config.sourceUserId,
    sourceUsername: config.sourceUsername,
    intervalMinutes: config.intervalMinutes,
    lastRunAt: config.lastRunAt,
    lastRunOk: config.lastRunOk,
    lastError: config.lastError,
    count,
  };
}

export async function authorizeXjtluAnnouncementSync(userId: number) {
  const session = await exportXjtluEhallSession(userId);
  await prisma.xjtluAnnouncementSyncConfig.upsert({
    where: { id: CONFIG_ID },
    update: {
      enabled: true,
      sourceUserId: userId,
      sourceUsername: session.username,
      encryptedSession: session.encryptedSession,
      lastError: null,
    },
    create: {
      id: CONFIG_ID,
      enabled: true,
      sourceUserId: userId,
      sourceUsername: session.username,
      encryptedSession: session.encryptedSession,
      intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    },
  });
  await syncXjtluAnnouncementsNow();
  return getXjtluAnnouncementSyncStatus();
}

export async function updateXjtluAnnouncementSyncConfig(input: { enabled?: boolean; intervalMinutes?: number }) {
  const config = await ensureConfig();
  if (input.enabled && !config.encryptedSession) throw Errors.badRequest("请先授权一个已连接融合门户的管理员账号");
  await prisma.xjtluAnnouncementSyncConfig.update({
    where: { id: CONFIG_ID },
    data: {
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes === undefined
        ? undefined
        : Math.min(1440, Math.max(5, Math.round(input.intervalMinutes))),
    },
  });
  return getXjtluAnnouncementSyncStatus();
}

export async function clearXjtluAnnouncementSyncAuthorization() {
  await ensureConfig();
  await prisma.xjtluAnnouncementSyncConfig.update({
    where: { id: CONFIG_ID },
    data: {
      enabled: false,
      sourceUserId: null,
      sourceUsername: "",
      encryptedSession: "",
      lastError: null,
    },
  });
  return getXjtluAnnouncementSyncStatus();
}

export async function syncXjtluAnnouncementsNow() {
  const locked = await runWithDistributedLock("xjtlu-announcement-sync", 120_000, async () => {
    const config = await ensureConfig();
    if (!config.encryptedSession) throw Errors.badRequest("尚未授权公告同步账号");
    try {
      const result = await getXjtluEhallNoticesFromEncryptedSession(config.encryptedSession);
      const seenAt = new Date();
      await prisma.$transaction([
        ...result.notices.map((notice, sourceOrder) => prisma.xjtluAnnouncement.upsert({
          where: { externalId: notice.id },
          update: {
            title: notice.title,
            publishedAtText: notice.publishedAt,
            author: notice.author,
            category: notice.category || "通知",
            url: notice.url,
            sourceOrder,
            lastSeenAt: seenAt,
          },
          create: {
            externalId: notice.id,
            title: notice.title,
            publishedAtText: notice.publishedAt,
            author: notice.author,
            category: notice.category || "通知",
            url: notice.url,
            sourceOrder,
            firstSeenAt: seenAt,
            lastSeenAt: seenAt,
          },
        })),
        prisma.xjtluAnnouncementSyncConfig.update({
          where: { id: CONFIG_ID },
          data: {
            encryptedSession: result.encryptedSession,
            sourceUsername: result.username,
            lastRunAt: seenAt,
            lastRunOk: true,
            lastError: null,
          },
        }),
      ]);
      return { synced: result.notices.length };
    } catch (error) {
      await prisma.xjtluAnnouncementSyncConfig.update({
        where: { id: CONFIG_ID },
        data: {
          lastRunAt: new Date(),
          lastRunOk: false,
          lastError: String((error as Error)?.message || error).slice(0, 1000),
        },
      });
      throw error;
    }
  });
  if (!locked.acquired) return { synced: 0, skipped: true };
  return { ...locked.result, skipped: false };
}

export async function listSharedXjtluAnnouncements(limit = 50) {
  const [config, rows] = await Promise.all([
    ensureConfig(),
    prisma.xjtluAnnouncement.findMany({
      orderBy: [{ lastSeenAt: "desc" }, { sourceOrder: "asc" }],
      take: Math.min(100, Math.max(1, limit)),
    }),
  ]);
  return {
    active: rows.length > 0,
    syncedAt: config.lastRunAt,
    notices: rows.map((row) => ({
      id: row.externalId,
      title: row.title,
      publishedAt: row.publishedAtText,
      author: row.author,
      category: row.category,
      url: row.url,
    })),
  };
}

export function startXjtluAnnouncementSyncScheduler() {
  const tick = async () => {
    const config = await ensureConfig();
    if (!config.enabled || !config.encryptedSession) return;
    const elapsed = config.lastRunAt ? Date.now() - config.lastRunAt.getTime() : Number.POSITIVE_INFINITY;
    if (elapsed < config.intervalMinutes * 60_000) return;
    await syncXjtluAnnouncementsNow().catch((error) => {
      console.warn("XJTLU announcement sync failed:", (error as Error)?.message || error);
    });
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref?.();
  setTimeout(() => void tick(), 3_000).unref?.();
  console.log("📢 XJTLU 融合门户公告同步器已挂载");
}
