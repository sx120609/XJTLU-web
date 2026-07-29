import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { ensureUserCanSpeak } from "./userModeration";
import {
  cents,
  closeExpiredMarketOrders,
} from "./marketCatalogService";
import { requireVerifiedMarketUser } from "./marketAccessService";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import { directTradeOrderAmounts, DIRECT_TRADE_NOTICE } from "./marketPolicy";
import {
  nextIntentExpiry,
  nextReservationExpiry,
} from "./marketLifecycle";
import {
  nextMarketTradeNo,
  serializeMarketOrder,
} from "./marketOrderService";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { isLearningMaterialCategory } from "./marketCatalog";

export const marketTradeIntentInputSchema = z.object({
  price: z.union([z.string(), z.number()]),
  message: z.string().trim().max(500).optional().default(""),
  availableTime: z.string().trim().min(1).max(300),
});

export const marketOfferInputSchema = z.object({
  price: z.union([z.string(), z.number()]),
  message: z.string().trim().max(500).optional().default(""),
});

export const marketTradeActionSchema = z.object({
  action: z.enum(["accept", "reject", "cancel"]),
});

export type MarketTradeIntentInput = z.infer<typeof marketTradeIntentInputSchema>;
export type MarketOfferInput = z.infer<typeof marketOfferInputSchema>;
export type MarketTradeAction = z.infer<typeof marketTradeActionSchema>["action"];

export type MarketTradeActor = {
  userId: number;
  role: string;
};

export function serializeTradeIntent(intent: any) {
  return {
    ...intent,
    price: amountCentsToMoney(intent.proposedPriceCents),
  };
}

export function serializeMarketOffer(offer: any) {
  return {
    ...offer,
    price: amountCentsToMoney(offer.priceCents),
  };
}

function canManageItem(sellerId: number, actor: MarketTradeActor) {
  return sellerId === actor.userId || ["admin", "mod"].includes(actor.role);
}

async function closeCompetingItemInterest(
  tx: any,
  itemId: number,
  selection: {
    tradeIntentId?: number;
    offerId?: number;
    wantedResponseId?: number;
  },
) {
  await tx.tradeIntent.updateMany({
    where: {
      itemId,
      status: "pending",
      ...(selection.tradeIntentId ? { id: { not: selection.tradeIntentId } } : {}),
    },
    data: { status: "rejected" },
  });
  await tx.marketOffer.updateMany({
    where: {
      itemId,
      status: "pending",
      ...(selection.offerId ? { id: { not: selection.offerId } } : {}),
    },
    data: { status: "rejected" },
  });
  await tx.wantedResponse.updateMany({
    where: {
      itemId,
      status: "pending",
      ...(selection.wantedResponseId ? { id: { not: selection.wantedResponseId } } : {}),
    },
    data: { status: "rejected" },
  });
}

export async function createMarketTradeIntent(
  actor: MarketTradeActor,
  itemId: number,
  input: MarketTradeIntentInput,
) {
  await closeExpiredMarketOrders();
  await requireVerifiedMarketUser(actor.userId, actor.role);
  await ensureUserCanSpeak(actor.userId);
  const proposedPriceCents = cents(input.price, false)!;

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, itemId);
    const item = await tx.marketItem.findUnique({
      where: { id: itemId },
      include: { seller: { select: MARKET_PUBLIC_USER_SELECT } },
    });
    if (
      !item
      || item.status !== "active"
      || item.visibility !== "public"
      || item.listingType !== "sell"
      || item.deliveryType !== "physical"
    ) {
      throw Errors.badRequest("商品当前不可提交购买意向");
    }
    if (item.sellerId === actor.userId) throw Errors.badRequest("不能购买自己发布的商品");
    if (!item.negotiable && proposedPriceCents !== item.priceCents) {
      throw Errors.badRequest("该商品不接受议价");
    }
    const duplicate = await tx.tradeIntent.findFirst({
      where: { itemId, buyerId: actor.userId, status: "pending" },
      select: { id: true },
    });
    if (duplicate) throw Errors.conflict("你已经提交过待处理的购买意向");
    const intent = await tx.tradeIntent.create({
      data: {
        itemId,
        buyerId: actor.userId,
        proposedPriceCents,
        message: input.message,
        availableTime: input.availableTime,
        expiresAt: nextIntentExpiry(),
      },
    });
    await tx.marketItem.update({
      where: { id: itemId },
      data: { offerCount: { increment: 1 } },
    });
    return { intent, item };
  });

  await notifyMarketUser(
    result.item.sellerId,
    "收到新的购买意向",
    `有人想以 ¥${amountCentsToMoney(proposedPriceCents)} 预订「${result.item.title}」`,
    "/market/mine?tab=intents",
    {
      type: "trade-intent",
      itemId,
      tradeIntentId: result.intent.id,
    },
  );
  return { ...serializeTradeIntent(result.intent), conversationId: null };
}

export async function transitionMarketTradeIntent(
  actor: MarketTradeActor,
  intentId: number,
  action: MarketTradeAction,
) {
  await closeExpiredMarketOrders();
  const reference = await prisma.tradeIntent.findUnique({
    where: { id: intentId },
    select: { itemId: true },
  });
  if (!reference) throw Errors.notFound("购买意向不存在");

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, reference.itemId);
    const intent = await tx.tradeIntent.findUnique({
      where: { id: intentId },
      include: { item: true },
    });
    if (!intent) throw Errors.notFound("购买意向不存在");
    if (intent.status !== "pending" || intent.expiresAt <= new Date()) {
      throw Errors.badRequest("该购买意向已经处理或过期");
    }

    if (action === "cancel") {
      if (intent.buyerId !== actor.userId) throw Errors.forbidden();
      const updated = await tx.tradeIntent.update({
        where: { id: intentId },
        data: { status: "cancelled" },
      });
      return { kind: "intent" as const, intent: updated, notification: null };
    }
    if (!canManageItem(intent.item.sellerId, actor)) throw Errors.forbidden();

    if (action === "reject") {
      const updated = await tx.tradeIntent.update({
        where: { id: intentId },
        data: { status: "rejected" },
      });
      return {
        kind: "intent" as const,
        intent: updated,
        notification: {
          userId: intent.buyerId,
          title: "购买意向未被接受",
          content: `卖家暂未接受你对「${intent.item.title}」的购买意向`,
          link: `/market/item/${intent.itemId}`,
          payload: {
            type: "trade-intent-rejected",
            itemId: intent.itemId,
            tradeIntentId: intentId,
          },
        },
      };
    }

    if (
      intent.item.status !== "active"
      || intent.item.visibility !== "public"
      || intent.item.deliveryType !== "physical"
    ) {
      throw Errors.badRequest("商品当前不可预订");
    }
    const reserved = await tx.marketItem.updateMany({
      where: {
        id: intent.itemId,
        status: "active",
        visibility: "public",
        deliveryType: "physical",
      },
      data: { status: "reserved" },
    });
    if (reserved.count !== 1) throw Errors.conflict("商品已被其他意向预订");
    const accepted = await tx.tradeIntent.updateMany({
      where: { id: intentId, status: "pending", expiresAt: { gt: new Date() } },
      data: { status: "accepted", acceptedAt: new Date() },
    });
    if (accepted.count !== 1) throw Errors.conflict("该购买意向状态已变化，请刷新后重试");
    await closeCompetingItemInterest(tx, intent.itemId, { tradeIntentId: intentId });
    const orderAmounts = directTradeOrderAmounts(intent.proposedPriceCents);
    const order = await tx.marketOrder.create({
      data: {
        itemId: intent.itemId,
        tradeIntentId: intentId,
        buyerId: intent.buyerId,
        sellerId: intent.item.sellerId,
        outTradeNo: nextMarketTradeNo(intent.buyerId),
        amountCents: intent.proposedPriceCents,
        platformFeeCents: orderAmounts.platformFeeCents,
        sellerAmountCents: orderAmounts.sellerAmountCents,
        deliveryType: "physical",
        status: "reserved",
        expiresAt: nextReservationExpiry(),
      },
    });
    await tx.marketConversation.upsert({
      where: {
        itemId_buyerId_sellerId: {
          itemId: intent.itemId,
          buyerId: intent.buyerId,
          sellerId: intent.item.sellerId,
        },
      },
      create: {
        itemId: intent.itemId,
        orderId: order.id,
        buyerId: intent.buyerId,
        sellerId: intent.item.sellerId,
      },
      update: { orderId: order.id },
    });
    return {
      kind: "order" as const,
      order,
      notification: {
        userId: intent.buyerId,
        title: "卖家已接受购买意向",
        content: `「${intent.item.title}」已为你预订，请在 72 小时内约定校内见面时间和地点。`,
        link: "/market/mine?tab=reservations",
        payload: {
          type: "trade-intent-accepted",
          itemId: intent.itemId,
          reservationId: order.id,
          notice: DIRECT_TRADE_NOTICE,
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
    : serializeTradeIntent(result.intent);
}

export async function createLegacyMarketOffer(
  actor: MarketTradeActor,
  itemId: number,
  input: MarketOfferInput,
) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  await ensureUserCanSpeak(actor.userId);
  const priceCents = cents(input.price, false)!;

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, itemId);
    const item = await tx.marketItem.findUnique({
      where: { id: itemId },
      include: { seller: { select: MARKET_PUBLIC_USER_SELECT } },
    });
    if (!item || item.status !== "active") {
      throw Errors.badRequest("商品当前不可提交购买意向");
    }
    if (isLearningMaterialCategory(item.category)) {
      throw Errors.badRequest("学习资料不接受议价或购买意向，请在资料专区直接购买");
    }
    if (item.listingType !== "sell") throw Errors.badRequest("求购信息请先通过站内沟通联系发布者");
    if (item.visibility !== "public" || item.deliveryType !== "physical") {
      throw Errors.badRequest("商品当前不可提交购买意向");
    }
    if (item.sellerId === actor.userId) throw Errors.badRequest("不能购买自己发布的商品");
    if (!item.negotiable && priceCents !== item.priceCents) {
      throw Errors.badRequest("该商品不接受议价");
    }
    const duplicate = await tx.marketOffer.findFirst({
      where: { itemId, buyerId: actor.userId, status: "pending" },
      select: { id: true },
    });
    if (duplicate) throw Errors.conflict("你已经提交过待处理的购买意向");
    const offer = await tx.marketOffer.create({
      data: {
        itemId,
        buyerId: actor.userId,
        priceCents,
        message: input.message,
      },
    });
    const conversation = await tx.marketConversation.upsert({
      where: {
        itemId_buyerId_sellerId: {
          itemId,
          buyerId: actor.userId,
          sellerId: item.sellerId,
        },
      },
      create: {
        itemId,
        buyerId: actor.userId,
        sellerId: item.sellerId,
        lastMessageAt: input.message ? new Date() : null,
      },
      update: {},
    });
    if (input.message) {
      await tx.marketMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: actor.userId,
          content: input.message,
        },
      });
    }
    await tx.marketItem.update({
      where: { id: itemId },
      data: { offerCount: { increment: 1 } },
    });
    return { offer, conversation, item };
  });

  await notifyMarketUser(
    result.item.sellerId,
    "收到新的购买意向",
    `有人想以 ¥${amountCentsToMoney(priceCents)} 购买「${result.item.title}」`,
    "/market/mine?tab=selling",
    {
      type: "market-offer",
      itemId,
      offerId: result.offer.id,
    },
  );
  return {
    ...serializeMarketOffer(result.offer),
    conversationId: result.conversation.id,
  };
}

export async function transitionLegacyMarketOffer(
  actor: MarketTradeActor,
  offerId: number,
  action: MarketTradeAction,
) {
  const reference = await prisma.marketOffer.findUnique({
    where: { id: offerId },
    select: { itemId: true },
  });
  if (!reference) throw Errors.notFound("购买意向不存在");

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, reference.itemId);
    const offer = await tx.marketOffer.findUnique({
      where: { id: offerId },
      include: { item: true },
    });
    if (!offer) throw Errors.notFound("购买意向不存在");
    if (offer.status !== "pending") throw Errors.badRequest("该购买意向已经处理");

    if (action === "cancel") {
      if (offer.buyerId !== actor.userId) throw Errors.forbidden();
      const updated = await tx.marketOffer.update({
        where: { id: offerId },
        data: { status: "cancelled" },
      });
      return { kind: "offer" as const, offer: updated, notification: null };
    }
    if (!canManageItem(offer.item.sellerId, actor)) throw Errors.forbidden();

    if (action === "reject") {
      const updated = await tx.marketOffer.update({
        where: { id: offerId },
        data: { status: "rejected" },
      });
      return {
        kind: "offer" as const,
        offer: updated,
        notification: {
          userId: offer.buyerId,
          title: "购买意向未被接受",
          content: `卖家暂未接受你对「${offer.item.title}」的购买意向`,
          link: `/market/item/${offer.itemId}`,
          payload: {
            type: "market-offer-rejected",
            itemId: offer.itemId,
            offerId,
          },
        },
      };
    }

    if (offer.item.status !== "active" || offer.item.visibility !== "public") {
      throw Errors.badRequest("商品当前不可预订");
    }
    if (offer.item.deliveryType === "digital") {
      throw Errors.badRequest("普通数字商品交易已关闭，请使用付费学习资料专区");
    }
    const reserved = await tx.marketItem.updateMany({
      where: {
        id: offer.itemId,
        status: "active",
        visibility: "public",
        deliveryType: "physical",
      },
      data: { status: "reserved" },
    });
    if (reserved.count !== 1) {
      throw Errors.conflict("商品刚刚已被其他购买意向预订，请刷新后重试");
    }
    const accepted = await tx.marketOffer.updateMany({
      where: { id: offerId, status: "pending" },
      data: { status: "accepted" },
    });
    if (accepted.count !== 1) throw Errors.conflict("该购买意向状态已变化，请刷新后重试");
    await closeCompetingItemInterest(tx, offer.itemId, { offerId });
    const orderAmounts = directTradeOrderAmounts(offer.priceCents);
    const order = await tx.marketOrder.create({
      data: {
        itemId: offer.itemId,
        offerId,
        buyerId: offer.buyerId,
        sellerId: offer.item.sellerId,
        outTradeNo: nextMarketTradeNo(offer.buyerId),
        amountCents: offer.priceCents,
        platformFeeCents: orderAmounts.platformFeeCents,
        sellerAmountCents: orderAmounts.sellerAmountCents,
        deliveryType: "physical",
        digitalDeliveryEncrypted: null,
        status: "delivering",
        expiresAt: null,
      },
    });
    await tx.marketConversation.upsert({
      where: {
        itemId_buyerId_sellerId: {
          itemId: offer.itemId,
          buyerId: offer.buyerId,
          sellerId: offer.item.sellerId,
        },
      },
      create: {
        itemId: offer.itemId,
        orderId: order.id,
        buyerId: offer.buyerId,
        sellerId: offer.item.sellerId,
      },
      update: { orderId: order.id },
    });
    return {
      kind: "order" as const,
      order,
      notification: {
        userId: offer.buyerId,
        title: "卖家已接受购买意向",
        content: `「${offer.item.title}」已预订。请在站内约定时间地点，当面验货后直接向卖家付款。`,
        link: "/market/mine?tab=orders",
        payload: {
          type: "market-offer-accepted",
          itemId: offer.itemId,
          orderId: order.id,
          notice: DIRECT_TRADE_NOTICE,
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
    : serializeMarketOffer(result.offer);
}
