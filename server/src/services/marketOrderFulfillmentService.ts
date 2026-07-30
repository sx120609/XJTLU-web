import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { closeExpiredMarketOrders } from "./marketCatalogService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { serializeMarketOrder } from "./marketOrderService";
import {
  TRANSACTION_POINT_RULES,
  awardTransactionPointsBatchInTransaction,
} from "./transactionPoints";

export const marketOrderActionSchema = z.object({
  action: z.enum([
    "buyer_confirm",
    "seller_confirm",
    "cancel",
    "request_refund",
    "dispute",
  ]),
  reason: z.string().trim().max(500).optional(),
});

export type MarketOrderActionInput = z.infer<typeof marketOrderActionSchema>;

export type MarketOrderActor = {
  userId: number;
  role: string;
};

type MarketOrderNotification = {
  userId: number;
  title: string;
  content: string;
  link: string;
  payload: Record<string, unknown>;
};

type MarketOrderTransitionResult = {
  response: any;
  notifications: MarketOrderNotification[];
  notifyStaff?: {
    outTradeNo: string;
    orderId: number;
  };
};

const ACTIVE_CONFIRMATION_STATUSES = ["negotiating", "paid", "delivering", "reserved"];
const ITEM_MUTATING_ACTIONS = new Set<MarketOrderActionInput["action"]>([
  "buyer_confirm",
  "seller_confirm",
  "cancel",
]);

function restoredItemStatus(item: any, now: Date) {
  if (item.status === "hidden") return "hidden";
  if (item.visibility === "targeted") return "targeted";
  return item.expiresAt && item.expiresAt <= now ? "expired" : "active";
}

function canAccessOrder(order: any, actor: MarketOrderActor) {
  return order.buyerId === actor.userId
    || order.sellerId === actor.userId
    || ["admin", "mod"].includes(actor.role);
}

function counterpartId(order: any, actor: MarketOrderActor) {
  return order.buyerId === actor.userId ? order.sellerId : order.buyerId;
}

function serializeForActor(order: any, actor: MarketOrderActor) {
  return serializeMarketOrder(order, actor.userId, actor.role);
}

export async function transitionMarketOrder(
  actor: MarketOrderActor,
  orderId: number,
  input: MarketOrderActionInput,
) {
  await closeExpiredMarketOrders();

  const result = await prisma.$transaction(async (tx): Promise<MarketOrderTransitionResult> => {
    await acquireMarketOrderLock(tx, orderId);
    const reference = await tx.marketOrder.findUnique({
      where: { id: orderId },
      select: { itemId: true },
    });
    if (!reference) throw Errors.notFound("交易记录不存在");

    if (ITEM_MUTATING_ACTIONS.has(input.action)) {
      await acquireMarketItemLock(tx, reference.itemId);
    }

    const order = await tx.marketOrder.findUnique({
      where: { id: orderId },
      include: { item: true, refunds: true, wantedPost: true },
    });
    if (!order || !canAccessOrder(order, actor)) {
      throw Errors.notFound("交易记录不存在");
    }

    const now = new Date();
    const isBuyer = order.buyerId === actor.userId;
    const isSeller = order.sellerId === actor.userId;

    if (input.action === "buyer_confirm" || input.action === "seller_confirm") {
      if (input.action === "buyer_confirm" && !isBuyer) throw Errors.forbidden();
      if (input.action === "seller_confirm" && !isSeller) throw Errors.forbidden();
      if (
        order.status === "completed"
        && order.buyerConfirmedAt
        && order.sellerConfirmedAt
      ) {
        return {
          response: serializeForActor(order, actor),
          notifications: [],
        };
      }
      if (!ACTIVE_CONFIRMATION_STATUSES.includes(order.status)) {
        throw Errors.badRequest("当前交易不能确认成交");
      }
      const alreadyConfirmed = input.action === "buyer_confirm"
        ? Boolean(order.buyerConfirmedAt)
        : Boolean(order.sellerConfirmedAt);
      if (alreadyConfirmed) {
        return {
          response: serializeForActor(order, actor),
          notifications: [],
        };
      }
      const confirmationData = input.action === "buyer_confirm"
        ? { buyerConfirmedAt: now }
        : { sellerConfirmedAt: now };
      let updated = await tx.marketOrder.update({
        where: { id: orderId },
        data: confirmationData,
      });
      const notifications: MarketOrderNotification[] = [];
      if (updated.buyerConfirmedAt && updated.sellerConfirmedAt) {
        const alreadyCompleted = await tx.marketOrder.findFirst({
          where: {
            itemId: order.itemId,
            id: { not: orderId },
            status: "completed",
          },
          select: { id: true },
        });
        if (alreadyCompleted) {
          throw Errors.conflict("该商品已由其他交易成交");
        }
        updated = await tx.marketOrder.update({
          where: { id: orderId },
          data: { status: "completed", completedAt: now, expiresAt: null },
        });
        if (order.deliveryType !== "digital") {
          await tx.marketItem.update({
            where: { id: order.itemId },
            data: {
              status: order.item.status === "hidden" ? "hidden" : "sold",
              soldAt: now,
            },
          });
        }
        const competingOrders = order.deliveryType === "physical"
          ? await tx.marketOrder.findMany({
            where: {
              itemId: order.itemId,
              id: { not: orderId },
              status: "negotiating",
            },
            select: { id: true, buyerId: true },
          })
          : [];
        if (competingOrders.length) {
          await tx.marketOrder.updateMany({
            where: { id: { in: competingOrders.map((entry) => entry.id) } },
            data: {
              status: "cancelled",
              closedAt: now,
              cancelReason: "商品已由其他买家成交",
            },
          });
          notifications.push(...competingOrders.map((entry) => ({
            userId: entry.buyerId,
            title: "商品已成交",
            content: `「${order.item.title}」已由卖家与其他买家确认成交`,
            link: "/market/messages",
            payload: { type: "market-item-sold", orderId: entry.id, itemId: order.itemId },
          })));
        }
        if (order.wantedPostId) {
          const alternativeWantedOrders = await tx.marketOrder.findMany({
            where: {
              wantedPostId: order.wantedPostId,
              id: { not: orderId },
              status: "negotiating",
            },
            select: { id: true, sellerId: true },
          });
          if (alternativeWantedOrders.length) {
            await tx.marketOrder.updateMany({
              where: { id: { in: alternativeWantedOrders.map((entry) => entry.id) } },
              data: {
                status: "cancelled",
                closedAt: now,
                cancelReason: "求购已通过其他响应成交",
              },
            });
            notifications.push(...alternativeWantedOrders.map((entry) => ({
              userId: entry.sellerId,
              title: "求购已成交",
              content: `「${order.wantedPost?.title || order.item.title}」已通过其他响应确认成交`,
              link: "/market/messages",
              payload: {
                type: "market-wanted-completed",
                orderId: entry.id,
                wantedPostId: order.wantedPostId,
              },
            })));
          }
          await tx.wantedPost.updateMany({
            where: {
              id: order.wantedPostId,
              status: { in: ["active", "responded", "matched"] },
            },
            data: { status: "completed" },
          });
          await tx.wantedResponse.updateMany({
            where: {
              wantedPostId: order.wantedPostId,
              id: { not: order.wantedResponseId ?? -1 },
              status: { in: ["pending", "accepted"] },
            },
            data: { status: "rejected" },
          });
          await tx.marketItem.updateMany({
            where: {
              sourceWantedPostId: order.wantedPostId,
              id: { not: order.itemId },
              visibility: "targeted",
              status: "targeted",
            },
            data: { status: "withdrawn" },
          });
        }
        if (order.deliveryType === "physical") {
          await awardTransactionPointsBatchInTransaction(tx, [
            {
              userId: order.buyerId,
              delta: TRANSACTION_POINT_RULES.physicalTradeBuyerCompleted,
              event: "physical_trade_buyer_completed",
              sourceType: "market_order",
              sourceId: orderId,
            },
            {
              userId: order.sellerId,
              delta: TRANSACTION_POINT_RULES.physicalTradeSellerCompleted,
              event: "physical_trade_seller_completed",
              sourceType: "market_order",
              sourceId: orderId,
            },
          ]);
        }
        if (order.paidAt) {
          await tx.marketSettlement.upsert({
            where: { orderId },
            create: {
              orderId,
              sellerId: order.sellerId,
              amountCents: order.sellerAmountCents,
              status: "available",
              availableAt: now,
            },
            update: { status: "available", availableAt: now },
          });
        }
        notifications.push(
          {
            userId: order.buyerId,
            title: "交易已完成",
            content: `「${order.item.title}」已由双方确认，成交积分已发放`,
            link: "/market/messages",
            payload: { type: "market-completed", orderId },
          },
          {
            userId: order.sellerId,
            title: "交易已完成",
            content: `「${order.item.title}」已由双方确认，成交积分已发放`,
            link: "/market/messages",
            payload: { type: "market-completed-seller", orderId },
          },
        );
      }
      return {
        response: serializeForActor(updated, actor),
        notifications,
      };
    }

    if (input.action === "cancel") {
      if (["negotiating", "reserved", "delivering"].includes(order.status) && !order.paidAt) {
        const reason = String(input.reason || "").trim();
        if (!reason) throw Errors.badRequest("请选择或填写取消原因");
        const cancelled = await tx.marketOrder.update({
          where: { id: orderId },
          data: {
            status: "cancelled",
            closedAt: now,
            cancelReason: reason,
            cancelledById: actor.userId,
            expiresAt: null,
          },
        });
        if (order.offerId) {
          await tx.marketOffer.updateMany({
            where: { id: order.offerId },
            data: { status: "cancelled" },
          });
        }
        if (order.tradeIntentId) {
          await tx.tradeIntent.updateMany({
            where: { id: order.tradeIntentId },
            data: { status: "cancelled" },
          });
        }
        if (order.wantedResponseId) {
          await tx.wantedResponse.updateMany({
            where: { id: order.wantedResponseId },
            data: { status: "cancelled" },
          });
        }
        if (order.wantedPostId) {
          await tx.wantedPost.updateMany({
            where: { id: order.wantedPostId, status: "matched" },
            data: { status: "responded" },
          });
        }
        await tx.marketItem.update({
          where: { id: order.itemId },
          data: {
            status: order.wantedResponseId && order.item.visibility === "targeted"
              ? "withdrawn"
              : restoredItemStatus(order.item, now),
          },
        });
        return {
          response: serializeForActor(cancelled, actor),
          notifications: [{
            userId: counterpartId(order, actor),
            title: "交易洽谈已结束",
            content: `「${order.item.title}」的洽谈已结束：${reason}`,
            link: "/market/mine?tab=trading",
            payload: { type: "market-negotiation-cancelled", orderId },
          }],
        };
      }

      if (order.status === "pending_payment" && order.offerId) {
        const cancelled = await tx.marketOrder.update({
          where: { id: orderId },
          data: {
            status: "cancelled",
            closedAt: now,
            note: input.reason || order.note,
            expiresAt: null,
          },
        });
        await tx.marketOffer.updateMany({
          where: { id: order.offerId },
          data: { status: "cancelled" },
        });
        await tx.marketItem.update({
          where: { id: order.itemId },
          data: { status: restoredItemStatus(order.item, now) },
        });
        return {
          response: serializeForActor(cancelled, actor),
          notifications: [],
        };
      }

      if (["paid", "delivering"].includes(order.status) && order.paidAt) {
        const refund = await tx.marketRefund.create({
          data: {
            orderId,
            requestedById: actor.userId,
            amountCents: order.amountCents,
            reason: input.reason || "历史交易取消",
          },
        });
        const updated = await tx.marketOrder.update({
          where: { id: orderId },
          data: { status: "refund_pending" },
        });
        return {
          response: {
            refund,
            order: serializeForActor({ ...order, ...updated }, actor),
          },
          notifications: [],
        };
      }
      throw Errors.badRequest("当前交易不能取消");
    }

    if (input.action === "request_refund") {
      if (!order.paidAt) {
        throw Errors.badRequest("靠浦未代收该商品款，请双方直接协商；如有违规请发起举报");
      }
      if (!isBuyer) throw Errors.forbidden();
      if (!["paid", "delivering", "disputed"].includes(order.status)) {
        throw Errors.badRequest("当前历史订单不能申请退款");
      }
      if (order.refunds.some((refund: any) => ["pending", "approved"].includes(refund.status))) {
        throw Errors.conflict("已有退款申请正在处理");
      }
      const refund = await tx.marketRefund.create({
        data: {
          orderId,
          requestedById: actor.userId,
          amountCents: order.amountCents,
          reason: input.reason || "买家申请退款",
        },
      });
      await tx.marketOrder.update({
        where: { id: orderId },
        data: { status: "refund_pending" },
      });
      return { response: refund, notifications: [] };
    }

    if (input.action === "dispute") {
      if (!["paid", "delivering", "reserved", "refund_pending", "no_show"].includes(order.status)) {
        throw Errors.badRequest("当前交易不能发起纠纷");
      }
      const updated = await tx.marketOrder.update({
        where: { id: orderId },
        data: { status: "disputed", note: input.reason || order.note },
      });
      return {
        response: serializeForActor(updated, actor),
        notifications: [],
        notifyStaff: { outTradeNo: order.outTradeNo, orderId },
      };
    }

    throw Errors.badRequest();
  });

  await Promise.all(result.notifications.map((notification) => notifyMarketUser(
    notification.userId,
    notification.title,
    notification.content,
    notification.link,
    notification.payload,
  )));

  if (result.notifyStaff) {
    const staff = await prisma.user.findMany({
      where: { role: { in: ["admin", "mod"] } },
      select: { id: true },
    });
    if (staff.length) {
      await prisma.notification.createMany({
        data: staff.map((user) => ({
          userId: user.id,
          category: "market",
          level: "strong",
          title: "市集交易纠纷",
          content: `交易记录 ${result.notifyStaff!.outTradeNo} 已发起纠纷`,
          link: "/admin?tab=market",
          source: "靠浦校园市集",
          payload: JSON.stringify({
            type: "market-dispute",
            orderId: result.notifyStaff!.orderId,
          }),
        })),
      }).catch(() => null);
    }
  }

  return result.response;
}
