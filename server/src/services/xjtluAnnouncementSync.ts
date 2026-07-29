import { prisma } from "../prisma";
import { Errors, HttpError } from "../utils/response";
import { runWithDistributedLock } from "./cache";
import { runTrackedJob } from "./runtimeHealth";
import {
  exportXjtluEhallSession,
  getXjtluEhallNoticesFromEncryptedSession,
} from "./xjtluEhallClient";

const CONFIG_ID = 1;
const DEFAULT_INTERVAL_MINUTES = 15;
const SYNC_LOCK_NAME = "xjtlu-announcement-sync";
const SYNC_LOCK_TTL_MS = 120_000;

function isExpiredAuthorization(error: unknown) {
  if (!(error instanceof HttpError)) return false;
  return error.status === 401
    || (error.status === 409 && /(?:授权|会话).{0,12}失效/.test(error.message));
}

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
  const locked = await runWithDistributedLock(
    SYNC_LOCK_NAME,
    SYNC_LOCK_TTL_MS,
    async () => {
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
      await syncXjtluAnnouncementsUnlocked();
    },
  );
  if (!locked.acquired) {
    throw Errors.conflict("公告同步任务正在运行，请稍后重新授权");
  }
  return getXjtluAnnouncementSyncStatus();
}

async function updateSyncConfigUnlocked(input: {
  enabled?: boolean;
  intervalMinutes?: number;
}) {
  const config = await ensureConfig();
  if (input.enabled && !config.encryptedSession) {
    throw Errors.badRequest("请先授权一个已连接融合门户的管理员账号");
  }
  await prisma.xjtluAnnouncementSyncConfig.update({
    where: { id: CONFIG_ID },
    data: {
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes === undefined
        ? undefined
        : Math.min(1440, Math.max(5, Math.round(input.intervalMinutes))),
    },
  });
}

export async function updateXjtluAnnouncementSyncConfig(input: { enabled?: boolean; intervalMinutes?: number }) {
  const locked = await runWithDistributedLock(
    SYNC_LOCK_NAME,
    SYNC_LOCK_TTL_MS,
    async () => {
      await updateSyncConfigUnlocked(input);
    },
  );
  if (!locked.acquired) {
    throw Errors.conflict("公告同步任务正在运行，请稍后修改配置");
  }
  return getXjtluAnnouncementSyncStatus();
}

export async function clearXjtluAnnouncementSyncAuthorization() {
  const locked = await runWithDistributedLock(
    SYNC_LOCK_NAME,
    SYNC_LOCK_TTL_MS,
    async () => {
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
    },
  );
  if (!locked.acquired) {
    throw Errors.conflict("公告同步任务正在运行，请稍后取消授权");
  }
  return getXjtluAnnouncementSyncStatus();
}

async function syncXjtluAnnouncementsUnlocked() {
  const config = await ensureConfig();
  if (!config.encryptedSession) {
    throw Errors.badRequest("尚未授权公告同步账号");
  }
  try {
    const result = await getXjtluEhallNoticesFromEncryptedSession(
      config.encryptedSession,
    );
    const seenAt = new Date();
    await prisma.$transaction([
      ...result.notices.map((notice, sourceOrder) =>
        prisma.xjtluAnnouncement.upsert({
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
        })
      ),
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
    const authorizationExpired = isExpiredAuthorization(error);
    await prisma.xjtluAnnouncementSyncConfig.update({
      where: { id: CONFIG_ID },
      data: {
        // An expired school credential cannot recover by retrying. Disable the
        // scheduler until an administrator explicitly authorizes a new session.
        enabled: authorizationExpired ? false : undefined,
        encryptedSession: authorizationExpired ? "" : undefined,
        lastRunAt: new Date(),
        lastRunOk: false,
        lastError: String((error as Error)?.message || error).slice(0, 1000),
      },
    });
    throw error;
  }
}

export async function syncXjtluAnnouncementsNow() {
  const locked = await runWithDistributedLock(
    SYNC_LOCK_NAME,
    SYNC_LOCK_TTL_MS,
    syncXjtluAnnouncementsUnlocked,
  );
  if (!locked.acquired) return { synced: 0, skipped: true };
  return { ...locked.result!, skipped: false };
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
  const tick = async () => runTrackedJob("xjtlu-announcement-sync", "融合门户公告同步", async () => {
    const config = await ensureConfig();
    if (!config.enabled || !config.encryptedSession) return;
    const elapsed = config.lastRunAt ? Date.now() - config.lastRunAt.getTime() : Number.POSITIVE_INFINITY;
    if (elapsed < config.intervalMinutes * 60_000) return;
    await syncXjtluAnnouncementsNow();
  }, 60_000).catch((error) => {
    console.warn("XJTLU announcement sync failed:", (error as Error)?.message || error);
  });
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref?.();
  setTimeout(() => void tick(), 3_000).unref?.();
  console.log("📢 XJTLU 融合门户公告同步器已挂载");
}
