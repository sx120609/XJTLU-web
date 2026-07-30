import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { getTransactionPointSummary } from "./transactionPoints";

export const pointPromotionTargetSchema = z.object({
  targetType: z.enum(["topic", "market_item", "wanted_post"]),
  targetId: z.coerce.number().int().positive(),
}).strict();

export const pointPromotionConfig = {
  enabled: false,
  status: "designing" as const,
  ruleVersion: "draft-v1",
  displayName: "积分推流",
  supportedTargetTypes: ["topic", "market_item", "wanted_post"] as const,
  mechanisms: [] as Array<{
    code: string;
    name: string;
    points: number;
    durationMinutes: number;
  }>,
  message: "积分推流机制正在设计中，当前仅开放统一入口，不会扣除积分。",
};

async function resolveOwnedTarget(userId: number, targetType: string, targetId: number) {
  if (targetType === "topic") {
    const topic = await prisma.topic.findUnique({
      where: { id: targetId },
      select: { id: true, authorId: true, title: true, hidden: true, createdAt: true },
    });
    if (!topic || topic.authorId !== userId) throw Errors.notFound("推广对象不存在");
    return {
      id: topic.id,
      type: "topic",
      title: topic.title,
      status: topic.hidden ? "hidden" : "active",
      eligible: !topic.hidden,
      href: `/forum/topic/${topic.id}`,
    };
  }
  if (targetType === "market_item") {
    const item = await prisma.marketItem.findUnique({
      where: { id: targetId },
      select: { id: true, sellerId: true, title: true, status: true, visibility: true },
    });
    if (!item || item.sellerId !== userId) throw Errors.notFound("推广对象不存在");
    return {
      id: item.id,
      type: "market_item",
      title: item.title,
      status: item.status,
      eligible: item.status === "active" && item.visibility === "public",
      href: `/market/item/${item.id}`,
    };
  }
  const wanted = await prisma.wantedPost.findUnique({
    where: { id: targetId },
    select: { id: true, authorId: true, title: true, status: true },
  });
  if (!wanted || wanted.authorId !== userId) throw Errors.notFound("推广对象不存在");
  return {
    id: wanted.id,
    type: "wanted_post",
    title: wanted.title,
    status: wanted.status,
    eligible: ["active", "responded"].includes(wanted.status),
    href: `/market/wanted/${wanted.id}`,
  };
}

export async function getPointPromotionContext(
  userId: number,
  input: z.infer<typeof pointPromotionTargetSchema>,
) {
  const [target, points] = await Promise.all([
    resolveOwnedTarget(userId, input.targetType, input.targetId),
    getTransactionPointSummary(prisma, userId, false),
  ]);
  return {
    config: pointPromotionConfig,
    target,
    pointBalance: points.points,
  };
}

export function pointPromotionUnavailable() {
  throw Errors.conflict(pointPromotionConfig.message);
}
