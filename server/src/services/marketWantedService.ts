import { WANTED_DEMAND_BOARD_SLUG } from "./defaultBoardCatalog";
import { amountCentsToMoney } from "./epay";
import { serializeItem } from "./marketCatalogService";
import { serializeWantedPromotion } from "./promotion";
import { acquireMarketItemLock } from "./marketItemLockService";

/**
 * Shared wanted-post projections and serializers.
 *
 * Public reads and authenticated write flows both use these helpers so author
 * anonymity, moderation visibility and response formatting cannot drift.
 */
export const wantedDemandTopicInclude = {
  where: { board: { is: { slug: WANTED_DEMAND_BOARD_SLUG } } },
  select: { id: true },
  orderBy: { id: "asc" as const },
  take: 1,
};

export async function closePendingWantedInterest(
  tx: any,
  wantedPostId: number,
) {
  const targetedItems = await tx.marketItem.findMany({
    where: { sourceWantedPostId: wantedPostId, visibility: "targeted" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const item of targetedItems) {
    await acquireMarketItemLock(tx, item.id);
  }
  const itemIds = targetedItems.map((item: { id: number }) => item.id);
  await tx.wantedResponse.updateMany({
    where: { wantedPostId, status: "pending" },
    data: { status: "expired" },
  });
  if (!itemIds.length) return;
  await tx.tradeIntent.updateMany({
    where: { itemId: { in: itemIds }, status: "pending" },
    data: { status: "expired" },
  });
  await tx.marketOffer.updateMany({
    where: { itemId: { in: itemIds }, status: "pending" },
    data: { status: "rejected" },
  });
  await tx.marketItem.updateMany({
    where: {
      id: { in: itemIds },
      visibility: "targeted",
      status: { in: ["targeted", "active", "negotiating"] },
    },
    data: { status: "withdrawn" },
  });
}

export function serializeWantedPost(post: any, viewerId?: number) {
  const { moderationNote, moderatedAt, linkedTopics, ...safePost } = post;
  const topicId = linkedTopics?.[0]?.id ?? post.topicId ?? null;
  const isAnonymous = Boolean(post.isAnonymous);
  const anonymousAlias = isAnonymous ? (post.anonymousAlias || "匿名同学") : null;
  const publicAuthor = isAnonymous ? {
    id: null,
    nickname: anonymousAlias,
    avatar: null,
    role: "anonymous",
    studentSso: false,
    anonymous: true,
  } : post.author;
  return {
    ...safePost,
    authorId: isAnonymous ? null : post.authorId,
    author: publicAuthor,
    isAnonymous,
    anonymousAlias,
    budgetMin: amountCentsToMoney(post.budgetMinCents),
    budgetMax: amountCentsToMoney(post.budgetMaxCents),
    responseCount: post._count?.responses ?? post.responseCount ?? 0,
    mine: Boolean(viewerId && post.authorId === viewerId),
    moderationNote: viewerId === post.authorId ? moderationNote : undefined,
    moderatedAt: viewerId === post.authorId ? moderatedAt : undefined,
    promotion: serializeWantedPromotion(post),
    topicId,
    topicUrl: topicId ? `/forum/topic/${topicId}` : null,
  };
}

export function serializeWantedResponse(response: any, viewerId = response.sellerId) {
  return {
    ...response,
    price: amountCentsToMoney(response.priceCents),
    item: response.item ? serializeItem(response.item, response.sellerId) : response.item,
    wantedPost: response.wantedPost
      ? serializeWantedPost(response.wantedPost, viewerId)
      : response.wantedPost,
  };
}

export function visibleWantedResponses(
  responses: any[],
  authorId: number,
  viewerId?: number,
  viewerRole?: string,
) {
  const canSeeAll = authorId === viewerId || ["admin", "mod"].includes(viewerRole || "");
  return canSeeAll ? responses : responses.filter((response) => response.sellerId === viewerId);
}
