import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { ensureUserCanSpeak } from "./userModeration";
import {
  ensureUserCanSubmitTopic,
  reviewTopicContent,
  shouldBypassAiReviewForUser,
} from "./topicAiReview";
import {
  cents,
  getMarketCategory,
  LEARNING_MATERIAL_WANTED_CATEGORY,
} from "./marketCatalogService";
import { requireVerifiedMarketUser } from "./marketAccessService";
import {
  addDays,
  nextWantedExpiry,
} from "./marketLifecycle";
import { evaluateMarketContent } from "./marketTrust";
import { notifyMatchesForWanted } from "./marketMatching";
import {
  ensureWantedDemandBoard,
  refreshWantedDemandTopicStats,
  syncPersistedWantedDemandTopic,
  syncWantedDemandTopic,
} from "./wantedDemandTopic";
import {
  MARKET_CAMPUSES,
  normalizeMarketCampus,
} from "./marketCampus";
import { createAnonymousAlias } from "./userTrust";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import {
  closePendingWantedInterest,
  serializeWantedPost,
} from "./marketWantedService";
import { acquireMarketWantedLock } from "./marketWantedLockService";

const requiredMarketCampusSchema = z.preprocess(
  normalizeMarketCampus,
  z.enum(MARKET_CAMPUSES, { errorMap: () => ({ message: "校区仅支持 SIP 或 TC" }) }),
);

export const marketWantedInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  budgetMin: z.union([z.string(), z.number()]),
  budgetMax: z.union([z.string(), z.number()]),
  brandModel: z.string().trim().max(160).optional().default(""),
  condition: z.string().trim().max(120).optional().default(""),
  expectedTradeTime: z.string().trim().min(1).max(300),
  campus: requiredMarketCampusSchema,
  location: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(10000),
  allowSellerOffers: z.boolean().optional().default(true),
  anonymous: z.boolean().optional().default(false),
  expiryDays: z.number().int().min(7).max(60).optional().default(21),
});

export const marketWantedPatchSchema = marketWantedInputSchema
  .omit({ anonymous: true })
  .partial();

export const marketWantedLifecycleSchema = z.object({
  action: z.enum(["cancel", "complete"]),
});

export type MarketWantedInput = z.infer<typeof marketWantedInputSchema>;
export type MarketWantedPatch = z.infer<typeof marketWantedPatchSchema>;
export type MarketWantedLifecycleAction = z.infer<typeof marketWantedLifecycleSchema>["action"];

export type MarketWantedActor = {
  userId: number;
  role: string;
};

export function isMarketStaff(role: string) {
  return role === "admin" || role === "mod";
}

export function canManageWantedPost(authorId: number, actor: MarketWantedActor) {
  return authorId === actor.userId || isMarketStaff(actor.role);
}

function ensureValidBudgetRange(budgetMinCents: number, budgetMaxCents: number) {
  if (budgetMaxCents <= 0 || budgetMinCents > budgetMaxCents) {
    throw Errors.badRequest("预算范围不正确");
  }
}

async function ensureWantedCategory(categorySlug: string) {
  if (categorySlug === LEARNING_MATERIAL_WANTED_CATEGORY) return;
  const category = await getMarketCategory(categorySlug);
  if (category.fulfillmentType !== "physical") throw Errors.badRequest("求购分类不合法");
}

export async function createMarketWantedPost(actor: MarketWantedActor, input: MarketWantedInput) {
  const authorId = actor.userId;
  await requireVerifiedMarketUser(authorId, actor.role, "publish");
  await ensureUserCanSpeak(authorId);
  await ensureUserCanSubmitTopic(authorId);
  await ensureWantedCategory(input.category);
  const budgetMinCents = cents(input.budgetMin) ?? 0;
  const budgetMaxCents = cents(input.budgetMax) ?? 0;
  ensureValidBudgetRange(budgetMinCents, budgetMaxCents);
  const safety = await evaluateMarketContent(
    prisma,
    [input.title, input.description, input.brandModel, input.location],
  );
  if (safety.action === "block") {
    throw Errors.badRequest("求购内容包含市集禁售或高风险信息，请修改后再发布");
  }
  const bypass = await shouldBypassAiReviewForUser(authorId, actor.role);
  const review = !bypass
    ? await reviewTopicContent({
      title: input.title,
      content: input.description,
      boardName: "市集求购",
      boardType: "market",
      metadata: { wantedPost: true, category: input.category },
    })
    : null;
  const reviewing = safety.action === "review" || review?.status === "blocked_ai";
  const wantedBoard = await ensureWantedDemandBoard();
  if (input.anonymous && !wantedBoard.anonymousEnabled) {
    throw Errors.forbidden("求购需求暂未开放匿名发布");
  }
  const anonymousAlias = input.anonymous ? createAnonymousAlias() : null;
  const { post, topic } = await prisma.$transaction(async (tx) => {
    const createdPost = await tx.wantedPost.create({
      data: {
        authorId,
        isAnonymous: input.anonymous,
        anonymousAlias,
        title: input.title,
        category: input.category,
        budgetMinCents,
        budgetMaxCents,
        brandModel: input.brandModel,
        condition: input.condition,
        expectedTradeTime: input.expectedTradeTime,
        campus: input.campus,
        location: input.location,
        description: input.description,
        allowSellerOffers: input.allowSellerOffers,
        status: reviewing ? "reviewing" : "active",
        expiresAt: addDays(new Date(), input.expiryDays),
      },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        _count: { select: { responses: true } },
      },
    });
    const createdTopic = await syncWantedDemandTopic(tx, createdPost, review ? {
      status: review.status,
      riskLevel: review.riskLevel,
      riskScore: review.riskScore,
      reason: review.reason,
      detail: review.detail,
      model: review.model,
      reviewedAt: new Date(),
    } : {});
    return {
      post: { ...createdPost, linkedTopics: [{ id: createdTopic.id }] },
      topic: createdTopic,
    };
  });
  await refreshWantedDemandTopicStats(topic, authorId);
  if (post.status === "active") {
    await notifyMatchesForWanted(post.id)
      .catch((error) => console.warn("[market] wanted matching notification failed", error));
  }
  return {
    ...serializeWantedPost(post, authorId),
    review: review ? { status: review.status, reason: review.reason } : null,
    safetyReview: safety.action === "review"
      ? { status: "reviewing", reason: "公开内容包含联系方式或需人工复核的信息" }
      : null,
  };
}

export async function updateMarketWantedPost(
  actor: MarketWantedActor,
  id: number,
  input: MarketWantedPatch,
) {
  const current = await prisma.wantedPost.findUnique({ where: { id } });
  if (!current) throw Errors.notFound("求购不存在");
  if (!canManageWantedPost(current.authorId, actor)) throw Errors.forbidden();
  if (!["active", "responded", "expired"].includes(current.status)) {
    throw Errors.badRequest("当前求购不能编辑");
  }
  if (!isMarketStaff(actor.role)) {
    await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  }
  const data: any = { ...input };
  delete data.budgetMin;
  delete data.budgetMax;
  delete data.expiryDays;
  if (input.category) {
    await ensureWantedCategory(input.category);
  }
  if (input.budgetMin !== undefined) data.budgetMinCents = cents(input.budgetMin) ?? 0;
  if (input.budgetMax !== undefined) data.budgetMaxCents = cents(input.budgetMax) ?? 0;
  const finalMin = data.budgetMinCents ?? current.budgetMinCents;
  const finalMax = data.budgetMaxCents ?? current.budgetMaxCents;
  ensureValidBudgetRange(finalMin, finalMax);
  const safety = await evaluateMarketContent(prisma, [
    input.title ?? current.title,
    input.description ?? current.description,
    input.brandModel ?? current.brandModel,
    input.location ?? current.location,
  ]);
  if (safety.action === "block") {
    throw Errors.badRequest("求购内容包含市集禁售或高风险信息，请修改后再发布");
  }
  if (input.expiryDays) data.expiresAt = addDays(new Date(), input.expiryDays);
  if (current.status === "expired") data.status = "active";
  if (safety.action === "review") data.status = "reviewing";
  const updated = await prisma.$transaction(async (tx) => {
    await acquireMarketWantedLock(tx, id);
    const lockedCurrent = await tx.wantedPost.findUnique({ where: { id } });
    if (!lockedCurrent) throw Errors.notFound("求购不存在");
    if (!canManageWantedPost(lockedCurrent.authorId, actor)) throw Errors.forbidden();
    if (!["active", "responded", "expired"].includes(lockedCurrent.status)) {
      throw Errors.badRequest("当前求购不能编辑");
    }
    if (lockedCurrent.updatedAt.getTime() !== current.updatedAt.getTime()) {
      throw Errors.conflict("求购状态已变化，请刷新后重试");
    }
    return tx.wantedPost.update({
      where: { id },
      data,
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        _count: { select: { responses: true } },
      },
    });
  });
  const topic = await syncPersistedWantedDemandTopic(updated);
  return serializeWantedPost({ ...updated, topicId: topic.id }, actor.userId);
}

export async function transitionMarketWantedPost(
  actor: MarketWantedActor,
  id: number,
  action: MarketWantedLifecycleAction,
) {
  const current = await prisma.wantedPost.findUnique({ where: { id } });
  if (!current) throw Errors.notFound("求购不存在");
  if (!canManageWantedPost(current.authorId, actor)) throw Errors.forbidden();
  const data = action === "complete"
    ? { status: "completed" }
    : { status: "cancelled" };
  const updated = await prisma.$transaction(async (tx) => {
    await acquireMarketWantedLock(tx, id);
    const lockedCurrent = await tx.wantedPost.findUnique({ where: { id } });
    if (!lockedCurrent) throw Errors.notFound("求购不存在");
    if (!canManageWantedPost(lockedCurrent.authorId, actor)) throw Errors.forbidden();
    if (lockedCurrent.updatedAt.getTime() !== current.updatedAt.getTime()) {
      throw Errors.conflict("求购状态已变化，请刷新后重试");
    }
    if (
      !["active", "responded"].includes(lockedCurrent.status)
    ) {
      throw Errors.badRequest("当前求购不能结束");
    }
    const post = await tx.wantedPost.update({
      where: { id },
      data,
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        _count: { select: { responses: true } },
      },
    });
    await closePendingWantedInterest(tx, id);
    return post;
  });
  const topic = await syncPersistedWantedDemandTopic(updated);
  return serializeWantedPost({ ...updated, topicId: topic.id }, actor.userId);
}
