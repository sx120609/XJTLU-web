import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { amountCentsToMoney } from "./epay";
import {
  closeExpiredMarketOrders,
  getMarketConfig,
  itemInclude,
  serializeItem,
  serializeMarketConfig,
} from "./marketCatalogService";
import { marketConversationVisibilityWhere } from "./marketConversationService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { serializeMarketOrder } from "./marketOrderService";
import { STUDENT_MARKET_PAYMENT_ENABLED } from "./marketPolicy";
import { MARKET_PUBLIC_USER_SELECT } from "./marketPublicUser";
import { sealMarketSensitive } from "./marketSensitiveService";
import {
  serializeWantedPost,
  serializeWantedResponse,
} from "./marketWantedService";

const PRIVATE_FAVORITE_STATUSES = ["draft", "reviewing", "hidden"];
const PUBLIC_PROFILE_ITEM_STATUSES = ["active", "reserved", "sold"];

export const marketPreferenceSchema = z.object({
  matchNotificationsEnabled: z.boolean(),
}).strict();

export const marketPayoutProfileSchema = z.object({
  method: z.enum(["alipay", "wxpay", "bank"]),
  account: z.string().trim().min(3).max(120),
  realName: z.string().trim().min(1).max(80),
}).strict();

export type MarketWorkspaceActor = {
  userId: number;
  role: string;
};

export type MarketPreferenceInput = z.infer<typeof marketPreferenceSchema>;
export type MarketPayoutProfileInput = z.infer<typeof marketPayoutProfileSchema>;

export async function getMarketPreference(userId: number) {
  return prisma.marketPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: {
      matchNotificationsEnabled: true,
      updatedAt: true,
    },
  });
}

export async function updateMarketPreference(
  userId: number,
  input: MarketPreferenceInput,
) {
  return prisma.marketPreference.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
    select: {
      matchNotificationsEnabled: true,
      updatedAt: true,
    },
  });
}

export async function toggleMarketFavorite(
  actor: MarketWorkspaceActor,
  itemId: number,
) {
  return prisma.$transaction(async (tx) => {
    await acquireMarketItemLock(tx, itemId);
    const item = await tx.marketItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        visibility: true,
        sourceWantedPost: { select: { authorId: true } },
      },
    });
    const canSeeTargeted = item?.visibility === "targeted"
      && item.sourceWantedPost?.authorId === actor.userId;
    if (
      !item
      || PRIVATE_FAVORITE_STATUSES.includes(item.status)
      || (item.visibility !== "public" && !canSeeTargeted)
    ) {
      throw Errors.notFound("商品不存在");
    }
    if (item.sellerId === actor.userId) {
      throw Errors.badRequest("不能收藏自己发布的商品");
    }

    const key = {
      itemId_userId: {
        itemId,
        userId: actor.userId,
      },
    };
    const existing = await tx.marketFavorite.findUnique({
      where: key,
      select: { id: true },
    });
    if (existing) {
      await tx.marketFavorite.delete({ where: { id: existing.id } });
    } else {
      await tx.marketFavorite.create({
        data: { itemId, userId: actor.userId },
      });
    }
    const favoriteCount = await tx.marketFavorite.count({
      where: { itemId },
    });
    await tx.marketItem.update({
      where: { id: itemId },
      data: { favoriteCount },
    });
    return {
      favorited: !existing,
      favoriteCount,
    };
  });
}

function serializeOrder(order: any, actor: MarketWorkspaceActor) {
  return serializeMarketOrder(order, actor.userId, actor.role);
}

export async function getMarketWorkspace(actor: MarketWorkspaceActor) {
  await closeExpiredMarketOrders();
  const userId = actor.userId;
  const [
    selling,
    orders,
    conversationCount,
    payoutProfile,
    wantedPosts,
    wantedResponses,
  ] = await Promise.all([
    prisma.marketItem.findMany({
      where: {
        sellerId: userId,
        deliveryType: "physical",
        category: { not: "digital_goods" },
      },
      include: itemInclude,
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.marketOrder.findMany({
      where: {
        deliveryType: "physical",
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      include: {
        item: {
          include: {
            images: { orderBy: { sort: "asc" }, take: 1 },
          },
        },
        buyer: { select: MARKET_PUBLIC_USER_SELECT },
        seller: { select: MARKET_PUBLIC_USER_SELECT },
        offer: true,
        settlement: true,
        refunds: { orderBy: { createdAt: "desc" } },
        reviews: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.marketConversation.count({
      where: {
        ...marketConversationVisibilityWhere(userId),
        messages: { some: { senderId: { not: userId }, readAt: null } },
      },
    }),
    prisma.marketPayoutProfile.findUnique({
      where: { userId },
      select: {
        method: true,
        accountMasked: true,
        realNameMasked: true,
        verified: true,
        updatedAt: true,
      },
    }),
    prisma.wantedPost.findMany({
      where: { authorId: userId },
      include: {
        author: { select: MARKET_PUBLIC_USER_SELECT },
        _count: { select: { responses: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.wantedResponse.findMany({
      where: { sellerId: userId },
      include: {
        seller: { select: MARKET_PUBLIC_USER_SELECT },
        wantedPost: true,
        item: { include: itemInclude },
        reservation: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
  ]);

  const visibleItemIds = Array.from(new Set(orders.map((order) => order.itemId)));
  const participantConversations = visibleItemIds.length
    ? await prisma.marketConversation.findMany({
      where: {
        ...marketConversationVisibilityWhere(userId),
        itemId: { in: visibleItemIds },
      },
      select: {
        id: true,
        itemId: true,
        buyerId: true,
      },
    })
    : [];
  const conversationByItemAndBuyer = new Map(
    participantConversations.map((conversation) => [
      `${conversation.itemId}:${conversation.buyerId}`,
      conversation.id,
    ]),
  );

  return {
    selling: selling.map((item) => serializeItem(item, userId)),
    orders: orders.map((order) => ({
      ...serializeOrder(order, actor),
      conversationId: conversationByItemAndBuyer.get(
        `${order.itemId}:${order.buyerId}`,
      ) || null,
    })),
    conversationCount,
    payoutProfile,
    wantedPosts: wantedPosts.map((post) => serializeWantedPost(post, userId)),
    wantedResponses: wantedResponses.map((response) => (
      serializeWantedResponse(response, userId)
    )),
  };
}

export async function getMarketSellerDashboard(actor: MarketWorkspaceActor) {
  await closeExpiredMarketOrders();
  const sellerId = actor.userId;
  const [items, orders, settlements, payoutProfile, config] = await Promise.all([
    prisma.marketItem.findMany({
      where: {
        sellerId,
        deliveryType: "physical",
        category: { not: "digital_goods" },
      },
      include: itemInclude,
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.marketOrder.findMany({
      where: { sellerId, deliveryType: "physical" },
      include: {
        item: {
          include: {
            images: { orderBy: { sort: "asc" }, take: 1 },
          },
        },
        buyer: { select: MARKET_PUBLIC_USER_SELECT },
        offer: true,
        settlement: true,
        refunds: { orderBy: { createdAt: "desc" } },
        conversation: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.marketSettlement.findMany({
      where: { sellerId, order: { deliveryType: "physical" } },
      include: {
        order: {
          include: {
            item: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.marketPayoutProfile.findUnique({
      where: { userId: sellerId },
      select: {
        method: true,
        accountMasked: true,
        realNameMasked: true,
        verified: true,
        updatedAt: true,
      },
    }),
    getMarketConfig(),
  ]);

  const sum = (values: number[]) => (
    values.reduce((total, value) => total + value, 0)
  );
  const pendingOrders = orders.filter((order) => (
    ["paid", "delivering"].includes(order.status)
  ));
  const frozenOrders = orders.filter((order) => (
    ["refund_pending", "disputed"].includes(order.status)
  ));
  const availableSettlements = settlements.filter((settlement) => (
    settlement.status === "available"
  ));
  const heldSettlements = settlements.filter((settlement) => (
    settlement.status === "held"
  ));
  const settledSettlements = settlements.filter((settlement) => (
    settlement.status === "settled"
  ));
  const paidOrders = orders.filter((order) => (
    Boolean(order.paidAt)
    && !["cancelled", "refunded"].includes(order.status)
  ));
  const timeline = [
    ...orders.filter((order) => Boolean(order.paidAt)).map((order) => ({
      key: `paid-${order.id}`,
      orderId: order.id,
      type: order.status === "refunded" ? "refunded" : "payment",
      title: order.item.title,
      amountCents: order.status === "refunded"
        ? -order.sellerAmountCents
        : order.sellerAmountCents,
      platformFeeCents: order.platformFeeCents,
      status: order.status,
      occurredAt: order.refundedAt || order.paidAt,
    })),
    ...settlements.map((settlement) => ({
      key: `settlement-${settlement.id}`,
      orderId: settlement.orderId,
      type: "settlement",
      title: settlement.order.item.title,
      amountCents: settlement.amountCents,
      platformFeeCents: settlement.order.platformFeeCents,
      status: settlement.status,
      occurredAt: settlement.settledAt
        || settlement.availableAt
        || settlement.createdAt,
      reference: settlement.reference,
    })),
  ].sort((a, b) => (
    new Date(b.occurredAt || 0).getTime()
    - new Date(a.occurredAt || 0).getTime()
  )).slice(0, 200);

  return {
    config: serializeMarketConfig(config),
    stats: {
      activeListings: items.filter((item) => item.status === "active").length,
      reservedListings: items.filter((item) => item.status === "reserved").length,
      soldListings: items.filter((item) => item.status === "sold").length,
      pendingDeliveryOrders: pendingOrders.length,
      pendingSettlementOrders: (
        availableSettlements.length + heldSettlements.length
      ),
    },
    balance: {
      grossCents: sum(paidOrders.map((order) => order.amountCents)),
      commissionCents: sum(
        paidOrders.map((order) => order.platformFeeCents),
      ),
      pendingCents: sum(
        pendingOrders.map((order) => order.sellerAmountCents),
      ),
      frozenCents: sum(
        frozenOrders.map((order) => order.sellerAmountCents),
      ) + sum(heldSettlements.map((settlement) => settlement.amountCents)),
      availableCents: sum(
        availableSettlements.map((settlement) => settlement.amountCents),
      ),
      settledCents: sum(
        settledSettlements.map((settlement) => settlement.amountCents),
      ),
    },
    items: items.map((item) => serializeItem(item, sellerId)),
    orders: orders.map((order) => serializeOrder(order, actor)),
    settlements: settlements.map((settlement) => ({
      ...settlement,
      amount: amountCentsToMoney(settlement.amountCents),
      order: serializeOrder(settlement.order, actor),
    })),
    timeline: timeline.map((entry) => ({
      ...entry,
      amount: amountCentsToMoney(Math.abs(entry.amountCents)),
      platformFee: amountCentsToMoney(entry.platformFeeCents),
    })),
    payoutProfile,
  };
}

export async function getPublicMarketUserProfile(
  userId: number,
  viewerId?: number,
) {
  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...MARKET_PUBLIC_USER_SELECT,
      marketPositiveRate: true,
    },
  });
  if (!userRecord) throw Errors.notFound("用户不存在");
  const { marketPositiveRate, ...user } = userRecord;
  const [
    listingCount,
    completedTrades,
    reviews,
    noShowCount,
    recentItems,
  ] = await Promise.all([
    prisma.marketItem.count({
      where: {
        sellerId: userId,
        deliveryType: "physical",
        category: { not: "digital_goods" },
        visibility: "public",
        status: { in: PUBLIC_PROFILE_ITEM_STATUSES },
      },
    }),
    prisma.marketOrder.count({
      where: {
        status: "completed",
        deliveryType: "physical",
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
    }),
    prisma.marketReview.aggregate({
      where: { targetUserId: userId },
      _avg: { rating: true },
      _count: true,
    }),
    prisma.marketOrder.count({
      where: {
        status: "no_show",
        deliveryType: "physical",
        OR: [
          { buyerId: userId, noShowParty: "buyer" },
          { sellerId: userId, noShowParty: "seller" },
        ],
      },
    }),
    prisma.marketItem.findMany({
      where: {
        sellerId: userId,
        deliveryType: "physical",
        category: { not: "digital_goods" },
        visibility: "public",
        status: { in: PUBLIC_PROFILE_ITEM_STATUSES },
      },
      include: itemInclude,
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
  ]);

  return {
    user,
    stats: {
      listingCount,
      completedTrades,
      rating: reviews._avg.rating || 0,
      reviewCount: reviews._count,
      positiveRate: marketPositiveRate,
      noShowCount,
    },
    recentItems: recentItems.map((item) => serializeItem(item, viewerId)),
  };
}

function maskPayoutAccount(value: string) {
  if (value.includes("@")) {
    const [name, host] = value.split("@", 2);
    return `${name.slice(0, 2)}***@${host}`;
  }
  return value.length <= 6
    ? `${value.slice(0, 1)}***${value.slice(-1)}`
    : `${value.slice(0, 3)}****${value.slice(-3)}`;
}

function maskPayoutName(value: string) {
  return value.length <= 1
    ? "*"
    : `${value.slice(0, 1)}${"*".repeat(Math.min(3, value.length - 1))}`;
}

export async function saveMarketPayoutProfile(
  userId: number,
  input: MarketPayoutProfileInput,
) {
  if (!STUDENT_MARKET_PAYMENT_ENABLED) {
    throw Errors.forbidden(
      "学生商品不使用平台结算或提现，无需保存收款资料",
    );
  }
  return prisma.marketPayoutProfile.upsert({
    where: { userId },
    create: {
      userId,
      method: input.method,
      accountEncrypted: sealMarketSensitive(input.account),
      accountMasked: maskPayoutAccount(input.account),
      realNameEncrypted: sealMarketSensitive(input.realName),
      realNameMasked: maskPayoutName(input.realName),
      verified: false,
    },
    update: {
      method: input.method,
      accountEncrypted: sealMarketSensitive(input.account),
      accountMasked: maskPayoutAccount(input.account),
      realNameEncrypted: sealMarketSensitive(input.realName),
      realNameMasked: maskPayoutName(input.realName),
      verified: false,
    },
    select: {
      method: true,
      accountMasked: true,
      realNameMasked: true,
      verified: true,
      updatedAt: true,
    },
  });
}
