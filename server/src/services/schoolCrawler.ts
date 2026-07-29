/**
 * 学校公告爬虫调度与入库。
 *
 * 网络抓取和 HTML 解析在 schoolCrawlerCore 中；当 JWXT_PROXY_URL 配置后，
 * 这部分会通过代理机执行，主服务只负责去重和 Prisma 入库。
 */
import { prisma } from "../prisma";
import { isDev } from "../config";
import { runWithDistributedLock } from "./cache";
import { invalidateBoardCaches, invalidateForumCaches } from "./cacheInvalidation";
import {
  refreshBoardTopicCount,
  refreshCourseRatingAggregates,
  refreshUserPostCount,
  refreshUserReplyCount,
} from "./forumStats";
import { crawlSchoolFeedSource } from "./schoolCrawlerTransport";
import { runTrackedJob } from "./runtimeHealth";
import {
  mutateTopicGlobalPin,
  publishGlobalPinnedTopicIds,
} from "./siteSettings";

export type SchoolFeedRunResult = {
  ok: boolean;
  newCount: number;
  error: string | null;
};

export type SchoolFeedRunListItem = SchoolFeedRunResult & {
  slug: string;
};

type SchoolFeedRunOptions = {
  dryRun?: boolean;
  force?: boolean;
};

const SOURCE_RUN_LOCK_TTL_MS = 10 * 60_000;

function sourceRunLockName(sourceId: number) {
  return `school-crawler:source:${sourceId}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
}

export async function withSchoolFeedSourceLock<T>(
  sourceId: number,
  task: () => Promise<T>,
) {
  return runWithDistributedLock(
    sourceRunLockName(sourceId),
    SOURCE_RUN_LOCK_TTL_MS,
    task,
  );
}

async function runOnceUnlocked(
  sourceId: number,
  opts: SchoolFeedRunOptions = {},
): Promise<SchoolFeedRunResult> {
  const source = await prisma.schoolFeedSource.findUnique({
    where: { id: sourceId },
    include: { board: true },
  });
  if (!source) {
    return { ok: false, newCount: 0, error: "source not found" };
  }
  if (!source.enabled && !opts.force) {
    return { ok: false, newCount: 0, error: "disabled" };
  }
  if (!source.board) {
    return { ok: false, newCount: 0, error: "board not bound" };
  }

  let totalNew = 0;
  let totalError: string | null = null;

  try {
    const existing = await prisma.schoolFeedItem.findMany({
      where: { sourceId: source.id },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map((item) => item.externalId));
    const crawled = await crawlSchoolFeedSource({
      slug: source.slug,
      listUrl: source.listUrl,
      maxPages: source.maxPages,
    }, {
      skipExternalIds: [...existingIds],
      dryRun: opts.dryRun,
    });
    if (isDev) {
      for (const page of crawled.pages) {
        console.log(`  [${source.slug}] page ${page.page}: ${page.count} items`);
      }
    }

    for (const item of crawled.items) {
      if (existingIds.has(item.externalId)) continue;
      if (opts.dryRun) {
        existingIds.add(item.externalId);
        totalNew += 1;
        continue;
      }

      let inserted = false;
      try {
        inserted = await prisma.$transaction(async (tx) => {
          const duplicate = await tx.schoolFeedItem.findUnique({
            where: {
              sourceId_externalId: {
                sourceId: source.id,
                externalId: item.externalId,
              },
            },
            select: { id: true },
          });
          if (duplicate) return false;

          const publishedAt = new Date(item.publishedAt);
          const fullContent = item.content
            || "_未能提取正文，请点击帖子顶部原文入口查看_";
          const topic = await tx.topic.create({
            data: {
              boardId: source.board!.id,
              authorId: source.botUserId,
              title: item.title.slice(0, 120),
              content: fullContent,
              metadata: JSON.stringify({
                sourceUrl: item.effectiveUrl,
                listUrl: item.url,
                external: item.isExternal,
                externalType: item.isExternal ? "wechat" : null,
                publishedAt: publishedAt.toISOString(),
                sourceName: source.name,
              }),
              createdAt: publishedAt,
              updatedAt: publishedAt,
              lastReplyAt: publishedAt,
              lastReplyById: source.botUserId,
            },
          });
          await tx.schoolFeedItem.create({
            data: {
              sourceId: source.id,
              externalId: item.externalId,
              url: item.url,
              title: item.title,
              publishedAt,
              topicId: topic.id,
            },
          });
          return true;
        });
      } catch (error) {
        if (prismaCode(error) !== "P2002") throw error;
      }
      existingIds.add(item.externalId);
      if (inserted) totalNew += 1;
    }

    if (totalNew > 0 && !opts.dryRun) {
      await prisma.$transaction(async (tx) => {
        await refreshBoardTopicCount(source.board!.id, tx);
        await refreshUserPostCount(source.botUserId, tx);
      });
    }
  } catch (error) {
    totalError = errorMessage(error);
    if (isDev) console.warn(`[crawler] ${source.slug} failed:`, totalError);
  }

  await prisma.schoolFeedSource.updateMany({
    where: { id: source.id },
    data: {
      lastRunAt: new Date(),
      lastRunOk: !totalError,
      lastError: totalError,
    },
  });
  if (totalNew > 0 && !opts.dryRun) {
    await invalidateBoardCaches();
    await invalidateForumCaches();
  }

  return {
    ok: !totalError,
    newCount: totalNew,
    error: totalError,
  };
}

/** 单次抓取某个源；同一源跨进程只允许一个运行实例。 */
export async function runOnce(
  sourceId: number,
  opts: SchoolFeedRunOptions = {},
): Promise<SchoolFeedRunResult> {
  const locked = await withSchoolFeedSourceLock(
    sourceId,
    () => runOnceUnlocked(sourceId, opts),
  );
  return locked.acquired
    ? locked.result!
    : { ok: false, newCount: 0, error: "source busy" };
}

/** 全部已启用源顺序执行，每个源仍有自己的跨进程运行锁。 */
export async function runAllOnce(
  opts: Pick<SchoolFeedRunOptions, "dryRun"> = {},
): Promise<SchoolFeedRunListItem[]> {
  const sources = await prisma.schoolFeedSource.findMany({
    where: { enabled: true },
    select: { id: true, slug: true },
    orderBy: { id: "asc" },
  });
  const results: SchoolFeedRunListItem[] = [];
  for (const source of sources) {
    const result = await runOnce(source.id, opts);
    results.push({ slug: source.slug, ...result });
  }
  return results;
}

export async function resetSourceAndRun(
  sourceId: number,
): Promise<SchoolFeedRunResult> {
  const locked = await withSchoolFeedSourceLock(sourceId, async () => {
    const source = await prisma.schoolFeedSource.findUnique({
      where: { id: sourceId },
      include: { board: true },
    });
    if (!source) {
      return { ok: false, newCount: 0, error: "source not found" };
    }
    if (!source.board) {
      return { ok: false, newCount: 0, error: "board not bound" };
    }

    const items = await prisma.schoolFeedItem.findMany({
      where: { sourceId: source.id },
      select: { topicId: true },
    });
    const topicIds = [...new Set(
      items
        .map((item) => item.topicId)
        .filter((id): id is number => typeof id === "number"),
    )];
    const cleanup = await prisma.$transaction(async (tx) => {
      const [topics, replyAuthors, ratings] = topicIds.length
        ? await Promise.all([
            tx.topic.findMany({
              where: { id: { in: topicIds } },
              distinct: ["authorId"],
              select: { authorId: true },
            }),
            tx.reply.findMany({
              where: { topicId: { in: topicIds } },
              distinct: ["authorId"],
              select: { authorId: true },
            }),
            tx.courseRating.findMany({
              where: { topicId: { in: topicIds } },
              select: { courseId: true },
            }),
          ])
        : [[], [], []];

      await tx.schoolFeedItem.deleteMany({ where: { sourceId: source.id } });
      if (topicIds.length) {
        await tx.courseRating.deleteMany({
          where: { topicId: { in: topicIds } },
        });
        await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
      }
      await refreshBoardTopicCount(source.board!.id, tx);
      for (const { authorId } of topics) {
        await refreshUserPostCount(authorId, tx);
      }
      for (const { authorId } of replyAuthors) {
        await refreshUserReplyCount(authorId, tx);
      }
      await refreshCourseRatingAggregates(
        ratings.map((rating) => rating.courseId),
        tx,
      );

      let globalPinnedIds: number[] | null = null;
      for (const topicId of topicIds) {
        globalPinnedIds = await mutateTopicGlobalPin(tx, topicId, false);
      }
      return { globalPinnedIds };
    });
    if (cleanup.globalPinnedIds) {
      await publishGlobalPinnedTopicIds(cleanup.globalPinnedIds);
    }
    await invalidateBoardCaches();
    await invalidateForumCaches({ includeCourses: true });

    return runOnceUnlocked(source.id, { force: true });
  });
  return locked.acquired
    ? locked.result!
    : { ok: false, newCount: 0, error: "source busy" };
}

let schedulerStarted = false;

/** 启动定时任务（每分钟检查一次，按 cronMinutes 决定是否运行） */
export function startScheduler() {
  const tickIntervalMs = 60_000;
  const lastRun = new Map<number, number>();

  const tick = async () => runTrackedJob(
    "school-crawler",
    "校园内容同步",
    async () => {
      await runWithDistributedLock("school-crawler:tick", 55_000, async () => {
        const sources = await prisma.schoolFeedSource.findMany({
          where: { enabled: true },
        });
        const now = Date.now();
        for (const source of sources) {
          const last = lastRun.get(source.id) ?? 0;
          if (now - last < source.cronMinutes * 60_000) continue;
          lastRun.set(source.id, now);
          runOnce(source.id).then((result) => {
            if (result.newCount > 0) {
              console.log(`  [crawler:${source.slug}] +${result.newCount} new`);
            }
          });
        }
      });
    },
    tickIntervalMs,
  );

  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(() => {
    tick().catch((error) => console.warn("[crawler] tick error:", error));
    const timer = setInterval(() => {
      tick().catch((error) => console.warn("[crawler] tick error:", error));
    }, tickIntervalMs);
    timer.unref?.();
  }, 5_000);

  console.log("🕷️  学校公告爬虫调度器已挂载（按各源 cronMinutes 调度）");
}
