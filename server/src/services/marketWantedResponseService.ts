import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { ensureUserCanSpeak } from "./userModeration";
import {
  cents,
  closeExpiredMarketOrders,
  itemInclude,
} from "./marketCatalogService";
import { requireVerifiedMarketUser } from "./marketAccessService";
import { evaluateMarketContent } from "./marketTrust";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import { serializeWantedResponse } from "./marketWantedService";
import { directTradeOrderAmounts } from "./marketPolicy";
import { nextReservationExpiry } from "./marketLifecycle";
import {
  nextMarketTradeNo,
  serializeMarketOrder,
} from "./marketOrderService";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketWantedLock } from "./marketWantedLockService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { acquireMarketCategoryLock } from "./marketCategoryLockService";

const wantedResponseImageSchema = z.string().trim().min(1).max(2048).refine(
  (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
  "图片地址格式不正确",
);

export const marketWantedResponseInputSchema = z.object({
  itemId: z.number().int().positive().optional(),
  title: z.string().trim().min(2).max(120).optional(),
  price: z.union([z.string(), z.number()]),
  description: z.string().trim().min(1).max(5000),
  images: z.array(wantedResponseImageSchema).max(9).optional().default([]),
  condition: z.enum(["new", "like_new", "good", "fair"]).optional().default("good"),
  brand: z.string().trim().max(80).optional().default(""),
  model: z.string().trim().max(80).optional().default(""),
  availableTime: z.string().trim().min(1).max(300),
});

export const marketWantedResponseActionSchema = z.object({
  action: z.enum(["accept", "reject", "cancel"]),
});

export type MarketWantedResponseInput = z.infer<typeof marketWantedResponseInputSchema>;
export type MarketWantedResponseAction = z.infer<typeof marketWantedResponseActionSchema>["action"];

export type MarketWantedResponseActor = {
  userId: number;
  role: string;
};

const wantedResponseInclude = {
  seller: { select: MARKET_PUBLIC_USER_SELECT },
  item: { include: itemInclude },
  reservation: true,
} as const;

export async function createMarketWantedResponse(
  actor: MarketWantedResponseActor,
  wantedPostId: number,
  input: MarketWantedResponseInput,
) {
  await closeExpiredMarketOrders();
  await requireVerifiedMarketUser(actor.userId, actor.role, "publish");
  await ensureUserCanSpeak(actor.userId);
  const priceCents = cents(input.price, false)!;
  const safety = await evaluateMarketContent(
    prisma,
    [input.title, input.description, input.brand, input.model],
  );
  if (safety.action !== "allow") {
    throw Errors.badRequest("响应内容请勿包含禁售物品或联系方式；卖家接受后系统会开放联系方式");
  }

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketWantedLock(tx, wantedPostId);
    const wanted = await tx.wantedPost.findUnique({ where: { id: wantedPostId } });
    if (
      !wanted
      || !["active", "responded"].includes(wanted.status)
      || wanted.expiresAt <= new Date()
    ) {
      throw Errors.badRequest("该求购当前不接受响应");
    }
    if (!wanted.allowSellerOffers) throw Errors.badRequest("发布者暂不接受卖家主动报价");
    if (wanted.authorId === actor.userId) throw Errors.badRequest("不能响应自己发布的求购");

    const duplicate = await tx.wantedResponse.findFirst({
      where: { wantedPostId, sellerId: actor.userId, status: "pending" },
      select: { id: true },
    });
    if (duplicate) throw Errors.conflict("你已经提交过待处理的响应");

    let item: any;
    if (input.itemId) {
      await acquireMarketItemLock(tx, input.itemId);
      item = await tx.marketItem.findUnique({ where: { id: input.itemId } });
      if (
        !item
        || item.sellerId !== actor.userId
        || item.status !== "active"
        || item.visibility !== "public"
        || item.deliveryType !== "physical"
      ) {
        throw Errors.badRequest("请选择自己当前在售的实体商品");
      }
    } else {
      if (!input.title || !input.images.length) {
        throw Errors.badRequest("未关联在售商品时，请填写商品名称并上传至少一张实拍图");
      }
      await acquireMarketCategoryLock(tx, wanted.category);
      const category = await tx.marketCategory.findUnique({
        where: { slug: wanted.category },
      });
      if (
        !category
        || !category.enabled
        || category.fulfillmentType !== "physical"
      ) {
        throw Errors.badRequest("该求购品类当前不可发布商品");
      }
      item = await tx.marketItem.create({
        data: {
          sellerId: actor.userId,
          listingType: "sell",
          title: input.title,
          description: input.description,
          category: wanted.category,
          deliveryType: "physical",
          priceCents,
          negotiable: false,
          condition: input.condition,
          tradeMode: "meetup",
          campus: wanted.campus,
          location: wanted.location,
          brand: input.brand,
          model: input.model,
          availableTime: input.availableTime,
          contactVisibility: "after_accept",
          expiresAt: wanted.expiresAt,
          visibility: "targeted",
          sourceWantedPostId: wantedPostId,
          status: "targeted",
          images: {
            create: input.images.map((url, sort) => ({ url, sort })),
          },
        },
      });
    }

    const response = await tx.wantedResponse.create({
      data: {
        wantedPostId,
        sellerId: actor.userId,
        itemId: item.id,
        priceCents,
        description: input.description,
        availableTime: input.availableTime,
      },
      include: wantedResponseInclude,
    });
    await tx.wantedPost.updateMany({
      where: { id: wantedPostId, status: "active" },
      data: { status: "responded" },
    });
    return { response, wanted };
  });

  await notifyMarketUser(
    result.wanted.authorId,
    "求购收到新响应",
    `有同学以 ¥${amountCentsToMoney(result.response.priceCents)} 响应了「${result.wanted.title}」`,
    `/market/wanted/${wantedPostId}`,
    {
      type: "wanted-response",
      wantedPostId,
      responseId: result.response.id,
    },
  );
  return serializeWantedResponse(result.response);
}

export async function transitionMarketWantedResponse(
  actor: MarketWantedResponseActor,
  responseId: number,
  action: MarketWantedResponseAction,
) {
  await closeExpiredMarketOrders();
  const reference = await prisma.wantedResponse.findUnique({
    where: { id: responseId },
    select: { wantedPostId: true },
  });
  if (!reference) throw Errors.notFound("求购响应不存在");

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketWantedLock(tx, reference.wantedPostId);
    const response = await tx.wantedResponse.findUnique({
      where: { id: responseId },
      include: { wantedPost: true, item: true },
    });
    if (!response) throw Errors.notFound("求购响应不存在");
    await acquireMarketItemLock(tx, response.itemId);
    const lockedItem = await tx.marketItem.findUnique({ where: { id: response.itemId } });
    if (!lockedItem) throw Errors.badRequest("响应商品当前不可用");
    if (response.status !== "pending") throw Errors.badRequest("该响应已经处理");

    if (action === "cancel") {
      if (response.sellerId !== actor.userId) throw Errors.forbidden();
      const updated = await tx.wantedResponse.update({
        where: { id: responseId },
        data: { status: "cancelled" },
        include: wantedResponseInclude,
      });
      if (lockedItem.visibility === "targeted") {
        await tx.marketItem.updateMany({
          where: { id: response.itemId, status: "targeted" },
          data: { status: "withdrawn" },
        });
      }
      return { kind: "response" as const, response: updated, notification: null };
    }

    const canManage = response.wantedPost.authorId === actor.userId
      || ["admin", "mod"].includes(actor.role);
    if (!canManage) throw Errors.forbidden();

    if (action === "reject") {
      const updated = await tx.wantedResponse.update({
        where: { id: responseId },
        data: { status: "rejected" },
        include: wantedResponseInclude,
      });
      if (lockedItem.visibility === "targeted") {
        await tx.marketItem.updateMany({
          where: { id: response.itemId, status: "targeted" },
          data: { status: "withdrawn" },
        });
      }
      return {
        kind: "response" as const,
        response: updated,
        notification: {
          userId: response.sellerId,
          title: "求购响应未被接受",
          content: `你对「${response.wantedPost.title}」的响应暂未被接受`,
          link: `/market/wanted/${response.wantedPostId}`,
          payload: {
            type: "wanted-response-rejected",
            wantedPostId: response.wantedPostId,
            responseId,
          },
        },
      };
    }

    if (
      !["active", "responded"].includes(response.wantedPost.status)
      || response.wantedPost.expiresAt <= new Date()
    ) {
      throw Errors.badRequest("求购当前不可匹配");
    }
    const allowedItemStatus = lockedItem.visibility === "targeted" ? "targeted" : "active";
    if (lockedItem.status !== allowedItemStatus) {
      throw Errors.badRequest("响应商品当前不可预订");
    }
    const amounts = directTradeOrderAmounts(response.priceCents);
    const matched = await tx.wantedPost.updateMany({
      where: {
        id: response.wantedPostId,
        status: { in: ["active", "responded"] },
        expiresAt: { gt: new Date() },
      },
      data: { status: "matched" },
    });
    if (matched.count !== 1) throw Errors.conflict("求购状态已变化，请刷新后重试");
    const reserved = await tx.marketItem.updateMany({
      where: { id: response.itemId, status: allowedItemStatus },
      data: { status: "reserved" },
    });
    if (reserved.count !== 1) throw Errors.conflict("响应商品已不可预订");
    const accepted = await tx.wantedResponse.updateMany({
      where: { id: responseId, status: "pending" },
      data: { status: "accepted" },
    });
    if (accepted.count !== 1) throw Errors.conflict("该响应状态已变化，请刷新后重试");
    await tx.wantedResponse.updateMany({
      where: {
        wantedPostId: response.wantedPostId,
        id: { not: responseId },
        status: "pending",
      },
      data: { status: "rejected" },
    });
    await tx.tradeIntent.updateMany({
      where: { itemId: response.itemId, status: "pending" },
      data: { status: "rejected" },
    });
    await tx.marketOffer.updateMany({
      where: { itemId: response.itemId, status: "pending" },
      data: { status: "rejected" },
    });
    await tx.wantedResponse.updateMany({
      where: { itemId: response.itemId, id: { not: responseId }, status: "pending" },
      data: { status: "rejected" },
    });
    const order = await tx.marketOrder.create({
      data: {
        itemId: response.itemId,
        wantedPostId: response.wantedPostId,
        wantedResponseId: responseId,
        buyerId: response.wantedPost.authorId,
        sellerId: response.sellerId,
        outTradeNo: nextMarketTradeNo(response.wantedPost.authorId),
        amountCents: response.priceCents,
        platformFeeCents: amounts.platformFeeCents,
        sellerAmountCents: amounts.sellerAmountCents,
        deliveryType: "physical",
        status: "reserved",
        expiresAt: nextReservationExpiry(),
      },
    });
    await tx.marketConversation.upsert({
      where: {
        itemId_buyerId_sellerId: {
          itemId: response.itemId,
          buyerId: response.wantedPost.authorId,
          sellerId: response.sellerId,
        },
      },
      create: {
        itemId: response.itemId,
        orderId: order.id,
        buyerId: response.wantedPost.authorId,
        sellerId: response.sellerId,
      },
      update: { orderId: order.id },
    });
    await tx.marketItem.updateMany({
      where: {
        sourceWantedPostId: response.wantedPostId,
        visibility: "targeted",
        id: { not: response.itemId },
        status: "targeted",
      },
      data: { status: "withdrawn" },
    });
    return {
      kind: "order" as const,
      order,
      notification: {
        userId: response.sellerId,
        title: "求购响应已被接受",
        content: `「${response.wantedPost.title}」已匹配，请在 72 小时内与买家约定校内见面。`,
        link: "/market/mine?tab=reservations",
        payload: {
          type: "wanted-response-accepted",
          wantedPostId: response.wantedPostId,
          reservationId: order.id,
        },
      },
    };
  });

  if (result.notification) {
    await notifyMarketUser(
      result.notification.userId,
      result.notification.title,
      result.notification.content,
      result.notification.link,
      result.notification.payload,
    );
  }
  return result.kind === "order"
    ? serializeMarketOrder(result.order, actor.userId, actor.role)
    : serializeWantedResponse(result.response);
}
