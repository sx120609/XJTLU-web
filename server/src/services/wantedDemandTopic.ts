import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { WANTED_DEMAND_BOARD_SLUG } from "./defaultBoardCatalog";
import { ensureBuiltinBoards } from "./defaultBoards";
import { invalidateForumCaches } from "./cacheInvalidation";
import { refreshBoardTopicCount, refreshUserPostCount } from "./forumStats";

type WantedDemandClient = Prisma.TransactionClient | typeof prisma;

export type WantedDemandSource = {
  id: number;
  authorId: number;
  isAnonymous?: boolean;
  anonymousAlias?: string | null;
  title: string;
  category: string;
  budgetMinCents: number;
  budgetMaxCents: number;
  brandModel: string;
  condition: string;
  expectedTradeTime: string;
  campus: string;
  location: string;
  description: string;
  status: string;
};

export type WantedDemandReviewSnapshot = {
  status?: string | null;
  riskLevel?: string | null;
  riskScore?: number | null;
  reason?: string | null;
  detail?: string | null;
  model?: string | null;
  reviewedAt?: Date | null;
};

export const wantedDemandTopicSelect = {
  id: true,
  hidden: true,
  boardId: true,
  isAnonymous: true,
  anonymousAlias: true,
} as const;

function money(cents: number) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2).replace(/\.00$/, "");
}

export function wantedDemandTopicContent(wanted: WantedDemandSource) {
  const details = [
    `**预算：** ¥${money(wanted.budgetMinCents)} – ¥${money(wanted.budgetMaxCents)}`,
    `**校区与地点：** ${wanted.campus} · ${wanted.location}`,
    `**希望交易时间：** ${wanted.expectedTradeTime}`,
  ];
  if (wanted.brandModel) details.push(`**品牌 / 型号：** ${wanted.brandModel}`);
  if (wanted.condition) details.push(`**可接受成色：** ${wanted.condition}`);
  details.push("", wanted.description, "", "> 这是结构化求购需求。联系方式不会公开，请通过站内商品响应继续沟通。");
  return details.join("\n\n");
}

function wantedDemandMetadata(wanted: WantedDemandSource) {
  return JSON.stringify({
    kind: "wanted_demand",
    wantedPostId: wanted.id,
    status: wanted.status,
    category: wanted.category,
    budgetMinCents: wanted.budgetMinCents,
    budgetMaxCents: wanted.budgetMaxCents,
    campus: wanted.campus,
    location: wanted.location,
  });
}

export async function syncWantedDemandTopic(
  client: WantedDemandClient,
  wanted: WantedDemandSource,
  review: WantedDemandReviewSnapshot = {},
) {
  const board = await client.board.findUnique({
    where: { slug: WANTED_DEMAND_BOARD_SLUG },
    select: { id: true },
  });
  if (!board) throw new Error("WANTED_DEMAND_BOARD_MISSING");

  const existing = await client.topic.findFirst({
    where: { boardId: board.id, linkedWantedPostId: wanted.id },
    orderBy: { id: "asc" },
    select: wantedDemandTopicSelect,
  });
  const hidden = ["reviewing", "removed"].includes(wanted.status);
  const common = {
    title: wanted.title,
    content: wantedDemandTopicContent(wanted),
    metadata: wantedDemandMetadata(wanted),
    isAnonymous: Boolean(wanted.isAnonymous),
    anonymousAlias: wanted.isAnonymous ? (wanted.anonymousAlias || null) : null,
    hidden,
    locked: wanted.status === "removed",
  };

  if (existing) {
    return client.topic.update({
      where: { id: existing.id },
      data: common,
      select: wantedDemandTopicSelect,
    });
  }

  const now = new Date();
  return client.topic.create({
    data: {
      ...common,
      boardId: board.id,
      authorId: wanted.authorId,
      linkedWantedPostId: wanted.id,
      aiReviewStatus: review.status || (hidden ? "manual_reviewing" : "auto_passed"),
      aiRiskLevel: review.riskLevel || (hidden ? "medium" : "low"),
      aiRiskScore: review.riskScore ?? 0,
      aiReviewReason: review.reason || "",
      aiReviewDetail: review.detail || "",
      aiModel: review.model || null,
      aiReviewedAt: review.reviewedAt || null,
      lastReplyAt: now,
      lastReplyById: wanted.authorId,
    },
    select: wantedDemandTopicSelect,
  });
}

export async function refreshWantedDemandTopicStats(topic: { boardId: number }, authorId: number) {
  await Promise.all([
    refreshBoardTopicCount(topic.boardId),
    refreshUserPostCount(authorId),
    invalidateForumCaches(),
  ]);
}

export async function ensureWantedDemandBoard() {
  const existing = await prisma.board.findUnique({ where: { slug: WANTED_DEMAND_BOARD_SLUG }, select: { id: true, anonymousEnabled: true } });
  if (existing) return existing;
  await ensureBuiltinBoards();
  const created = await prisma.board.findUnique({ where: { slug: WANTED_DEMAND_BOARD_SLUG }, select: { id: true, anonymousEnabled: true } });
  if (!created) throw new Error("WANTED_DEMAND_BOARD_MISSING");
  return created;
}

export async function syncPersistedWantedDemandTopic(wanted: WantedDemandSource, review: WantedDemandReviewSnapshot = {}) {
  await ensureWantedDemandBoard();
  const topic = await prisma.$transaction((tx) => syncWantedDemandTopic(tx, wanted, review));
  await refreshWantedDemandTopicStats(topic, wanted.authorId);
  return topic;
}

/**
 * 将升级前的结构化求购补入求购需求频道。每次启动限制一批，避免大型旧库启动时长时间阻塞；
 * 后续启动会继续补齐，且 linkedWantedPostId + 频道条件保证幂等。
 */
export async function backfillWantedDemandTopics(batchSize = 500) {
  await ensureBuiltinBoards();
  const wantedPosts = await prisma.wantedPost.findMany({
    where: {
      linkedTopics: {
        none: { board: { is: { slug: WANTED_DEMAND_BOARD_SLUG } } },
      },
    },
    orderBy: { id: "asc" },
    take: Math.max(1, Math.min(2000, batchSize)),
  });
  if (!wantedPosts.length) return 0;

  const boardIds = new Set<number>();
  const authorIds = new Set<number>();
  for (const wanted of wantedPosts) {
    const topic = await prisma.$transaction((tx) => syncWantedDemandTopic(tx, wanted));
    boardIds.add(topic.boardId);
    authorIds.add(wanted.authorId);
  }
  await Promise.all([
    ...[...boardIds].map((id) => refreshBoardTopicCount(id)),
    ...[...authorIds].map((id) => refreshUserPostCount(id)),
  ]);
  await invalidateForumCaches();
  return wantedPosts.length;
}
