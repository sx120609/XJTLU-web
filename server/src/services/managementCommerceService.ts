import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import type { ManagementPrincipal } from "./managementAuthService";
import { itemInclude, serializeItem } from "./marketCatalogService";
import { moderateMarketItemInTransaction } from "./marketItemWriteService";
import { notifyMatchesForItem } from "./marketMatching";
import { notifyMarketUser } from "./marketNotificationService";

export const managementMarketReviewQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  size: z.coerce.number().int().min(10).max(100).optional().default(30),
}).strict();

export const managementMarketReviewDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional().default(""),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "reject" && value.note.length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "驳回商品时必须填写原因" });
  }
});

export type ManagementMarketReviewQuery = z.infer<typeof managementMarketReviewQuerySchema>;
export type ManagementMarketReviewDecision = z.infer<typeof managementMarketReviewDecisionSchema>;

export async function listManagementMarketReviews(query: ManagementMarketReviewQuery) {
  const where: Prisma.MarketItemWhereInput = {
    status: "reviewing",
    visibility: "public",
    deliveryType: "physical",
  };
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { seller: { username: { contains: query.q, mode: "insensitive" } } },
      { seller: { nickname: { contains: query.q, mode: "insensitive" } } },
    ];
  }
  const [list, total] = await Promise.all([
    prisma.marketItem.findMany({
      where,
      include: itemInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.size,
      take: query.size,
    }),
    prisma.marketItem.count({ where }),
  ]);
  return {
    page: query.page,
    size: query.size,
    total,
    list: list.map((item) => serializeItem(item)),
  };
}

export async function decideManagementMarketReview(
  actor: ManagementPrincipal,
  itemId: number,
  input: ManagementMarketReviewDecision,
  ip = "",
) {
  const status = input.decision === "approve" ? "active" : "hidden";
  const item = await prisma.$transaction(async (tx) => {
    await moderateMarketItemInTransaction(
      tx,
      { userId: 0, role: "admin" },
      itemId,
      { status, note: input.note },
      true,
      ["reviewing"],
    );
    const updated = await tx.marketItem.update({
      where: { id: itemId },
      data: { moderatedByAdminId: actor.adminAccountId },
      include: itemInclude,
    });
    await tx.managementAuditLog.create({
      data: {
        actorId: actor.adminAccountId,
        action: input.decision === "approve"
          ? "management.market.item_approved"
          : "management.market.item_rejected",
        targetType: "market_item",
        targetId: String(itemId),
        summary: input.decision === "approve" ? "批准实物商品上架" : "驳回实物商品",
        detail: JSON.stringify({ status, note: input.note, title: updated.title }),
        ip: ip.slice(0, 128),
      },
    });
    return updated;
  });

  if (item.status === "active") {
    await notifyMatchesForItem(item.id)
      .catch((error) => console.warn("[management-market] item matching notification failed", error));
  }
  await notifyMarketUser(
    item.sellerId,
    input.decision === "approve" ? "商品审核通过" : "商品审核未通过",
    input.decision === "approve"
      ? `「${item.title}」已通过人工审核并公开上架`
      : `「${item.title}」未通过人工审核${input.note ? `：${input.note}` : ""}`,
    `/market/item/${itemId}`,
    { type: "management-market-review", itemId, status },
  );
  return serializeItem(item);
}

export function managementRouteId(value: string, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
    throw Errors.badRequest(`${label} ID 不合法`);
  }
  return id;
}
