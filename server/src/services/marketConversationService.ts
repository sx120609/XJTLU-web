import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { isLearningMaterialCategory } from "./marketCatalog";
import { requireVerifiedMarketUser } from "./marketAccessService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { serializeMarketOrder } from "./marketOrderService";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import {
  maskMarketContact,
  openMarketContact,
  sealMarketContact,
} from "./marketTrust";
import { ensureUserCanSpeak } from "./userModeration";

export const MARKET_PRIVATE_TRADE_STATUSES = [
  "reserved",
  "paid",
  "delivering",
  "completed",
  "disputed",
  "no_show",
] as const;

export const MARKET_MESSAGE_PAGE_SIZE = 300;

export const marketConversationCreateSchema = z.object({
  message: z.string().trim().max(2000).optional().default(""),
});

export const marketMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const marketContactCardSchema = z.object({
  method: z.enum(["wechat", "qq", "phone", "email", "other"]),
  value: z.string().trim().min(3).max(120),
});

export type MarketConversationActor = {
  userId: number;
  role: string;
};

export type MarketConversationCreateInput = z.infer<typeof marketConversationCreateSchema>;
export type MarketMessageInput = z.infer<typeof marketMessageSchema>;
export type MarketContactCardInput = z.infer<typeof marketContactCardSchema>;

export function isMarketPrivateTradeStatus(status: string) {
  return (MARKET_PRIVATE_TRADE_STATUSES as readonly string[]).includes(status);
}

export function marketConversationVisibilityWhere(userId: number) {
  return {
    orderId: { not: null },
    order: { status: { in: [...MARKET_PRIVATE_TRADE_STATUSES] } },
    item: { deliveryType: "physical" },
    OR: [{ buyerId: userId }, { sellerId: userId }],
  };
}

export function serializeMarketConversationItem(item: any) {
  return {
    id: item.id,
    sellerId: item.sellerId,
    listingType: item.listingType,
    title: item.title,
    category: item.category,
    deliveryType: item.deliveryType || "physical",
    price: amountCentsToMoney(item.priceCents),
    priceCents: item.priceCents,
    status: item.status,
    images: (item.images || []).map((image: any) => ({
      id: image.id,
      url: image.url,
      sort: image.sort,
    })),
    cover: item.images?.[0]?.url || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function ensurePhysicalConversationItem(item: {
  category: string;
  deliveryType: string;
}) {
  if (isLearningMaterialCategory(item.category) || item.deliveryType !== "physical") {
    throw Errors.badRequest("学习资料普通私聊已关闭，请使用订单售后服务单");
  }
}

function ensureConversationParticipant(
  conversation: {
    buyerId: number;
    sellerId: number;
    order: { status: string } | null;
  } | null,
  userId: number,
) {
  if (
    !conversation
    || !conversation.order
    || !isMarketPrivateTradeStatus(conversation.order.status)
    || (conversation.buyerId !== userId && conversation.sellerId !== userId)
  ) {
    throw Errors.notFound("会话不存在");
  }
}

export async function createMarketConversation(
  actor: MarketConversationActor,
  itemId: number,
  input: MarketConversationCreateInput,
) {
  if (input.message) await ensureUserCanSpeak(actor.userId);

  const itemReference = await prisma.marketItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      sellerId: true,
      category: true,
      deliveryType: true,
      status: true,
    },
  });
  if (!itemReference || ["hidden", "withdrawn"].includes(itemReference.status)) {
    throw Errors.notFound("商品不存在");
  }
  ensurePhysicalConversationItem(itemReference);
  if (itemReference.sellerId === actor.userId) {
    throw Errors.badRequest("不能与自己发起会话");
  }

  const orderReference = await prisma.marketOrder.findFirst({
    where: {
      itemId,
      buyerId: actor.userId,
      sellerId: itemReference.sellerId,
      status: { in: [...MARKET_PRIVATE_TRADE_STATUSES] },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!orderReference) {
    throw Errors.forbidden("卖家接受购买意向后才开放交易会话");
  }

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, orderReference.id);
    await acquireMarketItemLock(tx, itemId);
    const order = await tx.marketOrder.findUnique({
      where: { id: orderReference.id },
      include: {
        item: {
          select: {
            id: true,
            sellerId: true,
            title: true,
            category: true,
            deliveryType: true,
            status: true,
          },
        },
      },
    });
    if (
      !order
      || order.itemId !== itemId
      || order.buyerId !== actor.userId
      || order.sellerId !== order.item.sellerId
      || !isMarketPrivateTradeStatus(order.status)
    ) {
      throw Errors.forbidden("卖家接受购买意向后才开放交易会话");
    }
    if (["hidden", "withdrawn"].includes(order.item.status)) {
      throw Errors.notFound("商品不存在");
    }
    ensurePhysicalConversationItem(order.item);

    const conversation = await tx.marketConversation.upsert({
      where: {
        itemId_buyerId_sellerId: {
          itemId,
          buyerId: actor.userId,
          sellerId: order.sellerId,
        },
      },
      create: {
        itemId,
        orderId: order.id,
        buyerId: actor.userId,
        sellerId: order.sellerId,
      },
      update: { orderId: order.id },
    });

    if (input.message) {
      const message = await tx.marketMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: actor.userId,
          content: input.message,
        },
      });
      await tx.marketConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });
      return { conversation, itemTitle: order.item.title, messageSent: true };
    }
    return { conversation, itemTitle: order.item.title, messageSent: false };
  });

  if (result.messageSent) {
    await notifyMarketUser(
      itemReference.sellerId,
      "收到商品咨询",
      `有人咨询「${result.itemTitle}」`,
      `/market/messages?conversation=${result.conversation.id}`,
      {
        type: "market-message",
        itemId,
        conversationId: result.conversation.id,
      },
    );
  }
  return result.conversation;
}

export async function listMarketConversations(actor: MarketConversationActor) {
  const list = await prisma.marketConversation.findMany({
    where: marketConversationVisibilityWhere(actor.userId),
    include: {
      item: {
        select: {
          id: true,
          sellerId: true,
          listingType: true,
          title: true,
          category: true,
          deliveryType: true,
          priceCents: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          images: {
            select: { id: true, url: true, sort: true },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            take: 1,
          },
        },
      },
      buyer: { select: MARKET_PUBLIC_USER_SELECT },
      seller: { select: MARKET_PUBLIC_USER_SELECT },
      order: true,
      messages: {
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
          readAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
  });

  return list.map((conversation) => {
    const { messages, ...record } = conversation;
    return {
      ...record,
      item: serializeMarketConversationItem(conversation.item),
      order: conversation.order
        ? serializeMarketOrder(conversation.order, actor.userId, actor.role)
        : null,
      counterpart: conversation.buyerId === actor.userId
        ? conversation.seller
        : conversation.buyer,
      lastMessage: messages[0] || null,
    };
  });
}

export async function listMarketConversationMessages(
  actor: MarketConversationActor,
  conversationId: number,
) {
  const reference = await prisma.marketConversation.findUnique({
    where: { id: conversationId },
    select: { orderId: true },
  });
  if (!reference?.orderId) throw Errors.notFound("会话不存在");

  return prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, reference.orderId!);
    const conversation = await tx.marketConversation.findUnique({
      where: { id: conversationId },
      include: {
        item: { select: { category: true, deliveryType: true } },
        order: { select: { status: true } },
      },
    });
    ensureConversationParticipant(conversation, actor.userId);
    ensurePhysicalConversationItem(conversation!.item);

    const descending = await tx.marketMessage.findMany({
      where: { conversationId },
      include: { sender: { select: MARKET_PUBLIC_USER_SELECT } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MARKET_MESSAGE_PAGE_SIZE,
    });
    const messages = descending.reverse();
    const unreadMessageIds = messages
      .filter((message) => message.senderId !== actor.userId && !message.readAt)
      .map((message) => message.id);
    if (unreadMessageIds.length) {
      await tx.marketMessage.updateMany({
        where: {
          conversationId,
          id: { in: unreadMessageIds },
          senderId: { not: actor.userId },
          readAt: null,
        },
        data: { readAt: new Date() },
      });
    }
    return messages;
  });
}

export async function sendMarketConversationMessage(
  actor: MarketConversationActor,
  conversationId: number,
  input: MarketMessageInput,
) {
  await ensureUserCanSpeak(actor.userId);
  const reference = await prisma.marketConversation.findUnique({
    where: { id: conversationId },
    select: { orderId: true },
  });
  if (!reference?.orderId) throw Errors.notFound("会话不存在");

  const result = await prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, reference.orderId!);
    const conversation = await tx.marketConversation.findUnique({
      where: { id: conversationId },
      include: {
        item: {
          select: {
            id: true,
            title: true,
            category: true,
            deliveryType: true,
          },
        },
        order: { select: { status: true } },
      },
    });
    ensureConversationParticipant(conversation, actor.userId);
    ensurePhysicalConversationItem(conversation!.item);

    const message = await tx.marketMessage.create({
      data: {
        conversationId,
        senderId: actor.userId,
        content: input.content,
      },
      include: { sender: { select: MARKET_PUBLIC_USER_SELECT } },
    });
    await tx.marketConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });
    return { conversation: conversation!, message };
  });

  const recipientId = result.conversation.buyerId === actor.userId
    ? result.conversation.sellerId
    : result.conversation.buyerId;
  await notifyMarketUser(
    recipientId,
    "收到交易消息",
    `「${result.conversation.item.title}」有一条新消息`,
    `/market/messages?conversation=${conversationId}`,
    {
      type: "market-message",
      conversationId,
      itemId: result.conversation.itemId,
    },
  );
  return result.message;
}

export async function saveMarketContactCard(
  actor: MarketConversationActor,
  input: MarketContactCardInput,
) {
  await requireVerifiedMarketUser(actor.userId, actor.role);
  const valueEncrypted = sealMarketContact(input.value);
  const valueMasked = maskMarketContact(input.method, input.value);
  return prisma.marketContactCard.upsert({
    where: { userId: actor.userId },
    create: {
      userId: actor.userId,
      method: input.method,
      valueEncrypted,
      valueMasked,
    },
    update: {
      method: input.method,
      valueEncrypted,
      valueMasked,
    },
    select: { method: true, valueMasked: true, updatedAt: true },
  });
}

export async function getMarketOrderContactCards(
  actor: MarketConversationActor,
  orderId: number,
) {
  return prisma.$transaction(async (tx) => {
    await acquireMarketOrderLock(tx, orderId);
    const order = await tx.marketOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        deliveryType: true,
        buyerId: true,
        sellerId: true,
        item: { select: { category: true } },
        buyer: { select: MARKET_PUBLIC_USER_SELECT },
        seller: { select: MARKET_PUBLIC_USER_SELECT },
      },
    });
    if (
      !order
      || (order.buyerId !== actor.userId && order.sellerId !== actor.userId)
    ) {
      throw Errors.notFound("交易预约不存在");
    }
    if (!isMarketPrivateTradeStatus(order.status)) {
      throw Errors.forbidden("仅在卖家接受意向后的有效交易中开放联系方式");
    }
    if (
      order.deliveryType !== "physical"
      || isLearningMaterialCategory(order.item.category)
    ) {
      throw Errors.forbidden("学习资料订单不开放交易联系方式，请使用订单售后服务单");
    }

    const cards = await tx.marketContactCard.findMany({
      where: { userId: { in: [order.buyerId, order.sellerId] } },
      select: {
        userId: true,
        method: true,
        valueEncrypted: true,
        valueMasked: true,
        updatedAt: true,
      },
    });
    const cardByUser = new Map(cards.map((card) => [card.userId, card]));
    const serializeCard = (user: typeof order.buyer) => {
      const card = cardByUser.get(user.id);
      if (!card) return { user, contact: null };
      let value: string | null = null;
      try {
        value = openMarketContact(card.valueEncrypted);
      } catch {
        value = null;
      }
      return {
        user,
        contact: {
          method: card.method,
          value,
          valueMasked: card.valueMasked,
          updatedAt: card.updatedAt,
        },
      };
    };

    const ownUser = order.buyerId === actor.userId ? order.buyer : order.seller;
    const counterpartUser = order.buyerId === actor.userId ? order.seller : order.buyer;
    return {
      orderId,
      own: serializeCard(ownUser),
      counterpart: serializeCard(counterpartUser),
    };
  });
}
