import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import { isLearningMaterialCategory } from "./marketCatalog";
import { requireVerifiedMarketUser } from "./marketAccessService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { acquireMarketWantedLock } from "./marketWantedLockService";
import { serializeMarketOrder } from "./marketOrderService";
import { nextMarketTradeNo } from "./marketOrderService";
import { transitionMarketOrder } from "./marketOrderFulfillmentService";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import { ensureUserCanSpeak } from "./userModeration";
import { emitMarketChatEvent } from "./marketChatEvents";
import { TRANSACTION_POINT_RULES } from "./transactionPoints";

export const MARKET_PRIVATE_TRADE_STATUSES = [
  "negotiating",
  "reserved",
  "paid",
  "delivering",
  "completed",
  "cancelled",
  "disputed",
  "no_show",
] as const;

const MARKET_REUSABLE_TRADE_STATUSES = MARKET_PRIVATE_TRADE_STATUSES.filter(
  (status) => status !== "cancelled",
);

export const MARKET_MESSAGE_PAGE_SIZE = 50;

export const marketConversationCreateSchema = z.object({
  message: z.string().trim().max(2000).optional().default(""),
  wantedResponseId: z.number().int().positive().optional(),
  clientMessageId: z.string().trim().min(8).max(80).optional(),
});

export const marketMessageSchema = z.object({
  content: z.string().trim().max(2000).optional().default(""),
  clientMessageId: z.string().trim().min(8).max(80),
  attachments: z.array(z.object({
    url: z.string().trim().min(1).max(2000),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg"),
  }).strict()).max(6).optional().default([]),
}).strict().refine(
  (input) => Boolean(input.content || input.attachments.length),
  "消息内容或图片至少填写一项",
);

export const marketConversationQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default(""),
  filter: z.enum([
    "all",
    "unread",
    "pending_confirmation",
    "completed",
    // Keep the former values readable for old bookmarks and clients.
    "trading",
    "ended",
  ]).optional().default("all"),
}).strict();

export const marketMessageQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(10).max(100).optional().default(MARKET_MESSAGE_PAGE_SIZE),
}).strict();

export const marketMessageReportSchema = z.object({
  reason: z.string().trim().min(2).max(80),
  detail: z.string().trim().max(1000).optional().default(""),
}).strict();

export type MarketConversationActor = {
  userId: number;
  role: string;
};

export type MarketConversationCreateInput = z.infer<typeof marketConversationCreateSchema>;
export type MarketMessageInput = z.infer<typeof marketMessageSchema>;

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
  await requireVerifiedMarketUser(actor.userId, actor.role, "trade");
  if (input.message) await ensureUserCanSpeak(actor.userId);

  const itemReference = await prisma.marketItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      sellerId: true,
      category: true,
      deliveryType: true,
      status: true,
      visibility: true,
    },
  });
  if (
    !itemReference
    || !["active", "sold", "targeted"].includes(itemReference.status)
    || (itemReference.status === "targeted" && !input.wantedResponseId)
  ) {
    throw Errors.notFound("商品不存在");
  }
  ensurePhysicalConversationItem(itemReference);
  if (itemReference.sellerId === actor.userId) {
    throw Errors.badRequest("不能与自己发起会话");
  }

  const result = await prisma.$transaction(async (tx) => {
    let wantedResponse: {
      id: number;
      wantedPostId: number;
      sellerId: number;
      itemId: number;
      priceCents: number;
      status: string;
      wantedPost: { authorId: number; status: string; expiresAt: Date };
    } | null = null;
    if (input.wantedResponseId) {
      const responseReference = await tx.wantedResponse.findUnique({
        where: { id: input.wantedResponseId },
        select: { wantedPostId: true },
      });
      if (!responseReference) throw Errors.notFound("求购响应不存在");
      await acquireMarketWantedLock(tx, responseReference.wantedPostId);
      wantedResponse = await tx.wantedResponse.findUnique({
        where: { id: input.wantedResponseId },
        select: {
          id: true,
          wantedPostId: true,
          sellerId: true,
          itemId: true,
          priceCents: true,
          status: true,
          wantedPost: {
            select: { authorId: true, status: true, expiresAt: true },
          },
        },
      });
      if (
        !wantedResponse
        || wantedResponse.itemId !== itemId
        || wantedResponse.sellerId !== itemReference.sellerId
        || wantedResponse.wantedPost.authorId !== actor.userId
        || !["pending", "accepted"].includes(wantedResponse.status)
        || !["active", "responded"].includes(wantedResponse.wantedPost.status)
        || wantedResponse.wantedPost.expiresAt <= new Date()
      ) {
        throw Errors.notFound("求购响应不存在或已结束");
      }
    }
    await acquireMarketItemLock(tx, itemId);

    let orderCreated = false;
    let order = await tx.marketOrder.findFirst({
      where: {
        itemId,
        buyerId: actor.userId,
        sellerId: itemReference.sellerId,
        status: { in: [...MARKET_REUSABLE_TRADE_STATUSES] },
        wantedResponseId: wantedResponse?.id ?? null,
      },
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
      orderBy: { createdAt: "desc" },
    });
    const item = await tx.marketItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        sellerId: true,
        title: true,
        category: true,
        deliveryType: true,
        status: true,
        priceCents: true,
        visibility: true,
      },
    });
    if (!item || item.sellerId !== itemReference.sellerId) {
      throw Errors.notFound("商品不存在");
    }
    ensurePhysicalConversationItem(item);
    if (!order) {
      const canStart = item.status === "active"
        || (item.status === "targeted" && Boolean(wantedResponse));
      if (!canStart) throw Errors.badRequest("该商品已结束交易");
      order = await tx.marketOrder.create({
        data: {
          itemId,
          wantedPostId: wantedResponse?.wantedPostId,
          wantedResponseId: wantedResponse?.id,
          buyerId: actor.userId,
          sellerId: item.sellerId,
          outTradeNo: nextMarketTradeNo(actor.userId),
          amountCents: wantedResponse?.priceCents ?? item.priceCents,
          platformFeeCents: 0,
          sellerAmountCents: wantedResponse?.priceCents ?? item.priceCents,
          deliveryType: "physical",
          status: "negotiating",
        },
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
      orderCreated = true;
    }
    const wantedResponseOpened = wantedResponse?.status === "pending";
    if (wantedResponse?.status === "pending") {
      await tx.wantedResponse.update({
        where: { id: wantedResponse.id },
        data: { status: "accepted" },
      });
    }
    if (
      !order
      || order.itemId !== itemId
      || order.buyerId !== actor.userId
      || order.sellerId !== order.item.sellerId
      || !isMarketPrivateTradeStatus(order.status)
    ) {
      throw Errors.forbidden("当前交易会话不可用");
    }
    ensurePhysicalConversationItem(order.item);
    if (order.status === "completed" && input.message) {
      throw Errors.conflict("交易已由双方确认完成，私聊已关闭");
    }

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
        buyerLastReadAt: new Date(),
      },
      update: { orderId: order.id, buyerLastReadAt: new Date() },
    });

    if (input.message) {
      const existingMessage = input.clientMessageId
        ? await tx.marketMessage.findUnique({
          where: {
            conversationId_senderId_clientMessageId: {
              conversationId: conversation.id,
              senderId: actor.userId,
              clientMessageId: input.clientMessageId,
            },
          },
        })
        : null;
      const message = existingMessage || await tx.marketMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: actor.userId,
          content: input.message,
          kind: "text",
          clientMessageId: input.clientMessageId,
        },
      });
      await tx.marketConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });
      return {
        conversation,
        itemTitle: order.item.title,
        shouldNotify: true,
      };
    }
    return {
      conversation,
      itemTitle: order.item.title,
      shouldNotify: orderCreated || wantedResponseOpened,
    };
  });

  if (result.shouldNotify) {
    await notifyMarketUser(
      itemReference.sellerId,
      "收到新的交易私聊",
      `有同学就「${result.itemTitle}」发起了私聊`,
      `/market/messages?conversation=${result.conversation.id}`,
      {
        type: "market-message",
        itemId,
        conversationId: result.conversation.id,
      },
    );
  }
  emitMarketChatEvent(
    [actor.userId, itemReference.sellerId],
    "conversation",
    { conversationId: result.conversation.id, itemId },
  );
  return result.conversation;
}

export async function listMarketConversations(
  actor: MarketConversationActor,
  query: z.infer<typeof marketConversationQuerySchema>,
) {
  const search = query.q.trim();
  const list = await prisma.marketConversation.findMany({
    where: {
      ...marketConversationVisibilityWhere(actor.userId),
      ...(search ? {
        AND: [{
          OR: [
            { item: { title: { contains: search, mode: "insensitive" as const } } },
            { buyer: { nickname: { contains: search, mode: "insensitive" as const } } },
            { seller: { nickname: { contains: search, mode: "insensitive" as const } } },
            { messages: { some: { content: { contains: search, mode: "insensitive" as const } } } },
          ],
        }],
      } : {}),
      ...(query.filter === "pending_confirmation" || query.filter === "trading"
        ? { order: { status: { in: ["negotiating", "reserved", "paid", "delivering", "disputed"] } } }
        : query.filter === "completed"
          ? { order: { status: "completed" } }
          : query.filter === "ended"
          ? { order: { status: { in: ["completed", "cancelled", "no_show"] } } }
          : {}),
    },
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
          kind: true,
          readAt: true,
          createdAt: true,
          attachments: { orderBy: [{ sort: "asc" }, { id: "asc" }] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
      blocks: {
        where: {
          OR: [{ blockerId: actor.userId }, { blockedUserId: actor.userId }],
        },
        select: { blockerId: true, blockedUserId: true },
      },
      _count: {
        select: {
          messages: {
            where: { senderId: { not: actor.userId }, readAt: null },
          },
        },
      },
    },
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  const serialized = list.map((conversation) => {
    const { messages, blocks, _count, ...record } = conversation;
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
      unreadCount: _count.messages,
      blockedByMe: blocks.some((block) => block.blockerId === actor.userId),
      blockedByCounterpart: blocks.some((block) => block.blockedUserId === actor.userId),
    };
  });
  return query.filter === "unread"
    ? serialized.filter((conversation) => conversation.unreadCount > 0)
    : serialized;
}

export async function getMarketConversationUnreadSummary(
  actor: MarketConversationActor,
) {
  const visibility = marketConversationVisibilityWhere(actor.userId);
  const unreadMessageWhere = {
    senderId: { not: actor.userId },
    readAt: null,
  };
  const [unreadCount, conversationCount] = await Promise.all([
    prisma.marketMessage.count({
      where: {
        ...unreadMessageWhere,
        conversation: visibility,
      },
    }),
    prisma.marketConversation.count({
      where: {
        ...visibility,
        messages: { some: unreadMessageWhere },
      },
    }),
  ]);
  return { unreadCount, conversationCount };
}

function marketConversationConfirmationResult(
  actor: MarketConversationActor,
  conversationId: number,
  order: any,
) {
  const completed = order.status === "completed"
    && Boolean(order.buyerConfirmedAt)
    && Boolean(order.sellerConfirmedAt);
  return {
    conversationId,
    status: order.status,
    buyerConfirmedAt: order.buyerConfirmedAt,
    sellerConfirmedAt: order.sellerConfirmedAt,
    completed,
    pointsIssued: completed,
    rewards: {
      buyer: TRANSACTION_POINT_RULES.physicalTradeBuyerCompleted,
      seller: TRANSACTION_POINT_RULES.physicalTradeSellerCompleted,
    },
    order: serializeMarketOrder(order, actor.userId, actor.role),
  };
}

/**
 * The V1 physical-trade command is intentionally scoped to a chat. The server
 * infers the participant role, so a client cannot confirm on behalf of the
 * other party. The underlying transition locks the trade and item rows, while
 * the point ledger unique key makes retries and concurrent clicks idempotent.
 */
export async function confirmMarketConversationCompletion(
  actor: MarketConversationActor,
  conversationId: number,
) {
  const conversation = await prisma.marketConversation.findUnique({
    where: { id: conversationId },
    include: {
      item: { select: { category: true, deliveryType: true } },
      order: true,
    },
  });
  ensureConversationParticipant(conversation, actor.userId);
  ensurePhysicalConversationItem(conversation!.item);
  const order = conversation!.order!;
  const actorIsBuyer = conversation!.buyerId === actor.userId;
  const actorAlreadyConfirmed = actorIsBuyer
    ? Boolean(order.buyerConfirmedAt)
    : Boolean(order.sellerConfirmedAt);
  if (
    actorAlreadyConfirmed
    || (
      order.status === "completed"
      && order.buyerConfirmedAt
      && order.sellerConfirmedAt
    )
  ) {
    return marketConversationConfirmationResult(actor, conversationId, order);
  }

  const action = actorIsBuyer ? "buyer_confirm" : "seller_confirm";
  const updated = await transitionMarketOrder(actor, order.id, { action });
  await recordMarketOrderSystemEvent(
    order.id,
    actor.userId,
    action,
    updated.status,
  );
  return marketConversationConfirmationResult(actor, conversationId, updated);
}

export async function listMarketConversationMessages(
  actor: MarketConversationActor,
  conversationId: number,
  query: z.infer<typeof marketMessageQuerySchema>,
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
      where: {
        conversationId,
        ...(query.before ? { id: { lt: query.before } } : {}),
      },
      include: {
        sender: { select: MARKET_PUBLIC_USER_SELECT },
        attachments: { orderBy: [{ sort: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const hasMore = descending.length > query.limit;
    const messages = descending.slice(0, query.limit).reverse();
    const unreadMessageIds = messages
      .filter((message) => message.senderId !== actor.userId && !message.readAt)
      .map((message) => message.id);
    if (unreadMessageIds.length) {
      const readAt = new Date();
      await tx.marketMessage.updateMany({
        where: {
          conversationId,
          id: { in: unreadMessageIds },
          senderId: { not: actor.userId },
          readAt: null,
        },
        data: { readAt },
      });
      await tx.marketConversation.update({
        where: { id: conversationId },
        data: conversation!.buyerId === actor.userId
          ? { buyerLastReadAt: readAt }
          : { sellerLastReadAt: readAt },
      });
      emitMarketChatEvent(
        [conversation!.buyerId, conversation!.sellerId],
        "read",
        { conversationId, readerId: actor.userId, readAt: readAt.toISOString() },
      );
    }
    return {
      list: messages,
      nextCursor: hasMore ? messages[0]?.id || null : null,
    };
  });
}

export async function sendMarketConversationMessage(
  actor: MarketConversationActor,
  conversationId: number,
  input: MarketMessageInput,
) {
  await ensureUserCanSpeak(actor.userId);
  if (input.attachments.length) {
    const urls = [...new Set(input.attachments.map((attachment) => attachment.url))];
    const ownedAssets = await prisma.forumImageAsset.count({
      where: {
        url: { in: urls },
        createdById: actor.userId,
        status: { not: "rejected" },
      },
    });
    if (ownedAssets !== urls.length) throw Errors.badRequest("消息图片不存在、未通过审核或不属于当前账号");
  }
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
        blocks: { select: { blockerId: true, blockedUserId: true } },
      },
    });
    ensureConversationParticipant(conversation, actor.userId);
    ensurePhysicalConversationItem(conversation!.item);
    if (conversation!.order!.status === "completed") {
      throw Errors.conflict("交易已由双方确认完成，私聊已关闭");
    }
    if (conversation!.blocks.length) {
      throw Errors.forbidden("当前会话已被一方屏蔽，无法继续发送消息");
    }

    const message = await tx.marketMessage.upsert({
      where: {
        conversationId_senderId_clientMessageId: {
          conversationId,
          senderId: actor.userId,
          clientMessageId: input.clientMessageId,
        },
      },
      update: {},
      create: {
        conversationId,
        senderId: actor.userId,
        content: input.content,
        kind: input.attachments.length && !input.content ? "image" : "text",
        clientMessageId: input.clientMessageId,
        attachments: {
          create: input.attachments.map((attachment, index) => ({
            url: attachment.url,
            mimeType: attachment.mimeType,
            sort: index,
          })),
        },
      },
      include: {
        sender: { select: MARKET_PUBLIC_USER_SELECT },
        attachments: { orderBy: [{ sort: "asc" }, { id: "asc" }] },
      },
    });
    await tx.marketConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        ...(conversation!.buyerId === actor.userId
          ? { buyerLastReadAt: message.createdAt }
          : { sellerLastReadAt: message.createdAt }),
      },
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
  emitMarketChatEvent(
    [result.conversation.buyerId, result.conversation.sellerId],
    "message",
    {
      conversationId,
      messageId: result.message.id,
      senderId: actor.userId,
      createdAt: result.message.createdAt,
    },
  );
  return result.message;
}

export async function markMarketConversationRead(
  actor: MarketConversationActor,
  conversationId: number,
) {
  const conversation = await prisma.marketConversation.findUnique({
    where: { id: conversationId },
    include: { order: { select: { status: true } } },
  });
  ensureConversationParticipant(conversation, actor.userId);
  const readAt = new Date();
  await prisma.$transaction([
    prisma.marketMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: actor.userId },
        readAt: null,
      },
      data: { readAt },
    }),
    prisma.marketConversation.update({
      where: { id: conversationId },
      data: conversation!.buyerId === actor.userId
        ? { buyerLastReadAt: readAt }
        : { sellerLastReadAt: readAt },
    }),
  ]);
  emitMarketChatEvent(
    [conversation!.buyerId, conversation!.sellerId],
    "read",
    { conversationId, readerId: actor.userId, readAt: readAt.toISOString() },
  );
  return { readAt };
}

export async function toggleMarketConversationBlock(
  actor: MarketConversationActor,
  conversationId: number,
) {
  const conversation = await prisma.marketConversation.findUnique({
    where: { id: conversationId },
    include: { order: { select: { status: true } } },
  });
  ensureConversationParticipant(conversation, actor.userId);
  const blockedUserId = conversation!.buyerId === actor.userId
    ? conversation!.sellerId
    : conversation!.buyerId;
  const existing = await prisma.marketConversationBlock.findUnique({
    where: { conversationId_blockerId: { conversationId, blockerId: actor.userId } },
  });
  if (existing) {
    await prisma.marketConversationBlock.delete({ where: { id: existing.id } });
  } else {
    await prisma.marketConversationBlock.create({
      data: { conversationId, blockerId: actor.userId, blockedUserId },
    });
  }
  emitMarketChatEvent(
    [conversation!.buyerId, conversation!.sellerId],
    "conversation",
    { conversationId, blockChanged: true },
  );
  return { blocked: !existing };
}

export async function reportMarketConversationMessage(
  actor: MarketConversationActor,
  conversationId: number,
  messageId: number,
  input: z.infer<typeof marketMessageReportSchema>,
) {
  const conversation = await prisma.marketConversation.findUnique({
    where: { id: conversationId },
    include: { order: { select: { status: true } } },
  });
  ensureConversationParticipant(conversation, actor.userId);
  const message = await prisma.marketMessage.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true, senderId: true },
  });
  if (!message) throw Errors.notFound("消息不存在");
  if (message.senderId === actor.userId) throw Errors.badRequest("不能举报自己发送的消息");
  const duplicate = await prisma.marketReport.findFirst({
    where: { messageId, reporterId: actor.userId },
  });
  if (duplicate) throw Errors.conflict("该消息已经举报，请等待处理");
  return prisma.marketReport.create({
    data: {
      itemId: conversation!.itemId,
      orderId: conversation!.orderId,
      conversationId,
      messageId,
      reportedUserId: message.senderId,
      reporterId: actor.userId,
      type: "message",
      reason: input.reason,
      detail: input.detail,
    },
  });
}

export async function recordMarketOrderSystemEvent(
  orderId: number,
  actorUserId: number,
  action: "buyer_confirm" | "seller_confirm" | "cancel",
  status: string,
) {
  const conversation = await prisma.marketConversation.findUnique({
    where: { orderId },
    select: { id: true, buyerId: true, sellerId: true },
  });
  if (!conversation) return;
  const actorLabel = actorUserId === conversation.buyerId ? "买家" : "卖家";
  const events = action === "cancel"
    ? [{ key: `system:cancel:${actorUserId}`, content: `${actorLabel}已结束本次交易洽谈` }]
    : [
      {
        key: `system:${action}`,
        content: `${actorLabel}已确认商品实际成交`,
      },
      ...(status === "completed"
        ? [{ key: "system:completed", content: "双方均已确认，交易已完成，成交积分已发放" }]
        : []),
  ];
  let lastMessageAt: Date | null = null;
  for (const event of events) {
    const sharedCompletedMessage = event.key === "system:completed"
      ? await prisma.marketMessage.findFirst({
        where: {
          conversationId: conversation.id,
          clientMessageId: event.key,
        },
      })
      : null;
    const message = sharedCompletedMessage || await prisma.marketMessage.upsert({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId: conversation.id,
            senderId: actorUserId,
            clientMessageId: event.key,
          },
        },
        update: {},
        create: {
          conversationId: conversation.id,
          senderId: actorUserId,
          clientMessageId: event.key,
          kind: "system",
          content: event.content,
        },
      });
    lastMessageAt = message.createdAt;
  }
  if (lastMessageAt) {
    await prisma.marketConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt },
    });
    emitMarketChatEvent(
      [conversation.buyerId, conversation.sellerId],
      "trade",
      { conversationId: conversation.id, orderId, status },
    );
  }
}
