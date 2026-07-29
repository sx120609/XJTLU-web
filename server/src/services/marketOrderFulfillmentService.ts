import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { closeExpiredMarketOrders } from "./marketCatalogService";
import { acquireMarketItemLock } from "./marketItemLockService";
import { nextReservationExpiry } from "./marketLifecycle";
import { notifyMarketUser } from "./marketNotificationService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { serializeMarketOrder } from "./marketOrderService";

export const marketOrderActionSchema = z.object({
  action: z.enum([
    "set_meetup",
    "buyer_confirm",
    "seller_confirm",
    "cancel",
    "report_no_show",
    "request_refund",
    "dispute",
  ]),
  meetupTime: z.string().datetime().optional(),
  meetupLocation: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
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

const ACTIVE_CONFIRMATION_STATUSES = ["paid", "delivering", "reserved"];
const ITEM_MUTATING_ACTIONS = new Set<MarketOrderActionInput["action"]>([
  "buyer_confirm",
  "seller_confirm",
  "cancel",
  "report_no_show",
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
    if (!reference) throw Errors.notFound("交易预约不存在");

    if (ITEM_MUTATING_ACTIONS.has(input.action)) {
      await acquireMarketItemLock(tx, reference.itemId);
    }

    const order = await tx.marketOrder.findUnique({
      where: { id: orderId },
      include: { item: true, refunds: true, wantedPost: true },
    });
    if (!order || !canAccessOrder(order, actor)) {
      throw Errors.notFound("交易预约不存在");
    }

    const now = new Date();
    const isBuyer = order.buyerId === actor.userId;
    const isSeller = order.sellerId === actor.userId;

    if (input.action === "set_meetup") {
      if (order.deliveryType === "digital") {
        throw Errors.badRequest("电子资料历史订单无需设置面交安排");
      }
      if (!ACTIVE_CONFIRMATION_STATUSES.includes(order.status)) {
        throw Errors.badRequest("当前预约不能修改面交安排");
      }
      const meetupTime = input.meetupTime ? new Date(input.meetupTime) : order.meetupTime;
      const meetupLocation = input.meetupLocation ?? order.meetupLocation;
      if (!meetupTime || !meetupLocation.trim()) {
        throw Errors.badRequest("请同时填写面交时间和校内地点");
      }
      if (input.meetupTime) {
        const earliest = now.getTime() + 15 * 60_000;
        const latest = now.getTime() + 30 * 24 * 60 * 60_000;
        if (meetupTime.getTime() < earliest || meetupTime.getTime() > latest) {
          throw Errors.badRequest("面交时间须在 15 分钟后至 30 天内");
        }
      }
      const updated = await tx.marketOrder.update({
        where: { id: orderId },
        data: {
          status: order.status === "reserved" ? "reserved" : "delivering",
          meetupTime,
          meetupLocation,
          meetupReminderSentAt: null,
          note: input.note ?? order.note,
          expiresAt: order.status === "reserved"
            ? nextReservationExpiry(now, meetupTime)
            : order.expiresAt,
        },
      });
      return {
        response: serializeForActor(updated, actor),
        notifications: [{
          userId: counterpartId(order, actor),
          title: "校内面交安排已更新",
          content: `「${order.item.title}」的见面时间或地点已更新`,
          link: "/market/mine?tab=reservations",
          payload: { type: "market-meetup", orderId },
        }],
      };
    }

    if (input.action === "buyer_confirm" || input.action === "seller_confirm") {
      if (input.action === "buyer_confirm" && !isBuyer) throw Errors.forbidden();
      if (input.action === "seller_confirm" && !isSeller) throw Errors.forbidden();
      if (!ACTIVE_CONFIRMATION_STATUSES.includes(order.status)) {
        throw Errors.badRequest("当前预约不能确认完成");
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
        if (order.wantedPostId) {
          await tx.wantedPost.updateMany({
            where: { id: order.wantedPostId, status: "matched" },
            data: { status: "completed" },
          });
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
            content: `「${order.item.title}」已由双方确认，可评价卖家`,
            link: "/market/mine?tab=history",
            payload: { type: "market-completed", orderId },
          },
          {
            userId: order.sellerId,
            title: "交易已完成",
            content: `「${order.item.title}」已由双方确认，可评价买家`,
            link: "/market/mine?tab=history",
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
      if (["reserved", "delivering"].includes(order.status) && !order.paidAt) {
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
          data: { status: restoredItemStatus(order.item, now) },
        });
        return {
          response: serializeForActor(cancelled, actor),
          notifications: [{
            userId: counterpartId(order, actor),
            title: "交易预约已取消",
            content: `「${order.item.title}」的预约已取消：${reason}`,
            link: "/market/mine?tab=reservations",
            payload: { type: "market-reservation-cancelled", orderId },
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

    if (input.action === "report_no_show") {
      if (!isBuyer && !isSeller) throw Errors.forbidden();
      if (order.status !== "reserved" || order.paidAt) {
        throw Errors.badRequest("当前预约不能登记爽约");
      }
      const reason = String(input.reason || "").trim();
      if (!reason) throw Errors.badRequest("请说明爽约情况");
      const noShowParty = isBuyer ? "seller" : "buyer";
      const updated = await tx.marketOrder.update({
        where: { id: orderId },
        data: {
          status: "no_show",
          closedAt: now,
          noShowParty,
          cancelReason: reason,
          cancelledById: actor.userId,
          expiresAt: null,
        },
      });
      if (order.offerId) {
        await tx.marketOffer.updateMany({
          where: { id: order.offerId },
          data: { status: "expired" },
        });
      }
      if (order.tradeIntentId) {
        await tx.tradeIntent.updateMany({
          where: { id: order.tradeIntentId },
          data: { status: "expired" },
        });
      }
      if (order.wantedResponseId) {
        await tx.wantedResponse.updateMany({
          where: { id: order.wantedResponseId },
          data: { status: "expired" },
        });
      }
      if (order.wantedPostId) {
        await tx.wantedPost.updateMany({
          where: { id: order.wantedPostId, status: "matched" },
          data: { status: "responded" },
        });
      }
      await tx.marketItem.updateMany({
        where: { id: order.itemId, status: "reserved" },
        data: { status: restoredItemStatus(order.item, now) },
      });
      return {
        response: serializeForActor(updated, actor),
        notifications: [{
          userId: counterpartId(order, actor),
          title: "交易预约被登记爽约",
          content: `「${order.item.title}」的另一方提交了爽约记录；如有异议请发起申诉。`,
          link: "/market/mine?tab=reservations",
          payload: { type: "market-no-show", orderId },
        }],
      };
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
