import { acquireMarketItemLock } from "./marketItemLockService";
import { acquireMarketOrderLock } from "./marketOrderLockService";
import { LEARNING_ISSUE_SLA_MS } from "./marketPolicy";

export const WANTED_LIFETIME_DAYS = 21;
export const INTENT_LIFETIME_DAYS = 7;
export const RESERVATION_LIFETIME_HOURS = 72;

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addHours(from: Date, hours: number) {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export function nextWantedExpiry(now = new Date()) {
  return addDays(now, WANTED_LIFETIME_DAYS);
}

export function nextIntentExpiry(now = new Date()) {
  return addDays(now, INTENT_LIFETIME_DAYS);
}

export function nextReservationExpiry(now = new Date(), meetupTime?: Date | null) {
  const defaultExpiry = addHours(now, RESERVATION_LIFETIME_HOURS);
  if (!meetupTime || meetupTime <= now) return defaultExpiry;
  const afterMeetup = addHours(meetupTime, 24);
  const latestAllowed = addDays(now, 14);
  return afterMeetup < latestAllowed ? afterMeetup : latestAllowed;
}

/**
 * Executes bounded, idempotent lifecycle maintenance. It deliberately works
 * with the existing MarketItem/MarketOrder records so historical payment data
 * remains readable while all new reservations use the no-payment states.
 */
export async function sweepMarketLifecycle(prisma: any, now = new Date()) {
  const expiredReservations = await prisma.marketOrder.findMany({
    where: {
      OR: [
        { status: "reserved", expiresAt: { lte: now } },
        { status: "pending_payment", expiresAt: { lte: now } },
      ],
    },
    select: { id: true },
    take: 100,
  });

  let closedReservations = 0;
  for (const candidate of expiredReservations) {
    const closed = await prisma.$transaction(async (tx: any) => {
      await acquireMarketOrderLock(tx, candidate.id);
      const reservation = await tx.marketOrder.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          itemId: true,
          offerId: true,
          tradeIntentId: true,
          wantedPostId: true,
          wantedResponseId: true,
          status: true,
          expiresAt: true,
          learningCommerceOrder: {
            select: {
              id: true,
              status: true,
              paymentDueAt: true,
            },
          },
        },
      });
      if (
        !reservation
        || !["reserved", "pending_payment"].includes(reservation.status)
        || !reservation.expiresAt
        || reservation.expiresAt > now
      ) {
        return false;
      }
      if (reservation.learningCommerceOrder) {
        const learningOrder = reservation.learningCommerceOrder;
        if (learningOrder.status !== "pending_payment") {
          await tx.marketOrder.update({
            where: { id: reservation.id },
            data: { expiresAt: null },
          });
          return false;
        }
        if (learningOrder.paymentDueAt && learningOrder.paymentDueAt > now) {
          await tx.marketOrder.update({
            where: { id: reservation.id },
            data: { expiresAt: learningOrder.paymentDueAt },
          });
          return false;
        }
      }
      await acquireMarketItemLock(tx, reservation.itemId);
      const expired = await tx.marketOrder.updateMany({
        where: {
          id: reservation.id,
          status: { in: ["reserved", "pending_payment"] },
          expiresAt: { lte: now },
        },
        data: {
          status: "expired",
          closedAt: now,
          cancelReason: "预约超时自动解除",
        },
      });
      if (expired.count !== 1) return false;
      if (reservation.learningCommerceOrder) {
        const learningOrderId = reservation.learningCommerceOrder.id;
        const transitioned = await tx.learningCommerceOrder.updateMany({
          where: {
            id: learningOrderId,
            status: "pending_payment",
            OR: [
              { paymentDueAt: { lte: now } },
              { paymentDueAt: null },
            ],
          },
          data: {
            status: "expired",
            statusVersion: { increment: 1 },
            paymentDueAt: null,
            cancelledAt: now,
            cancelReason: "付款超时，订单已自动关闭",
          },
        });
        if (transitioned.count === 1) {
          const latestEvent = await tx.learningOrderEvent.aggregate({
            where: { commerceOrderId: learningOrderId },
            _max: { sequence: true },
          });
          await tx.learningOrderEvent.create({
            data: {
              commerceOrderId: learningOrderId,
              sequence: (latestEvent._max.sequence || 0) + 1,
              type: "PAYMENT_TIMEOUT",
              fromStatus: "pending_payment",
              toStatus: "expired",
              detail: JSON.stringify({ sweptAt: now.toISOString() }),
            },
          });
        }
      }
      if (reservation.offerId) {
        await tx.marketOffer.updateMany({
          where: { id: reservation.offerId },
          data: { status: "expired" },
        });
      }
      if (reservation.tradeIntentId) {
        await tx.tradeIntent.updateMany({
          where: { id: reservation.tradeIntentId },
          data: { status: "expired" },
        });
      }
      if (reservation.wantedResponseId) {
        await tx.wantedResponse.updateMany({
          where: { id: reservation.wantedResponseId },
          data: { status: "expired" },
        });
      }
      if (reservation.wantedPostId) {
        await tx.wantedPost.updateMany({
          where: { id: reservation.wantedPostId, status: "matched", expiresAt: { gt: now } },
          data: { status: "responded" },
        });
      }
      const item = await tx.marketItem.findUnique({ where: { id: reservation.itemId }, select: { expiresAt: true, visibility: true } });
      if (item) {
        const restoredStatus = item.expiresAt && item.expiresAt <= now ? "expired" : item.visibility === "targeted" ? "targeted" : "active";
        await tx.marketItem.updateMany({ where: { id: reservation.itemId, status: "reserved" }, data: { status: restoredStatus } });
      }
      return true;
    }).catch(() => false);
    if (closed) closedReservations += 1;
  }

  const expiredWanted = await prisma.wantedPost.findMany({
    where: { status: { in: ["active", "responded"] }, expiresAt: { lte: now } },
    select: { id: true },
    take: 200,
  });
  if (expiredWanted.length) {
    const ids = expiredWanted.map((post: { id: number }) => post.id);
    await prisma.$transaction([
      prisma.wantedPost.updateMany({ where: { id: { in: ids }, status: { in: ["active", "responded"] } }, data: { status: "expired" } }),
      prisma.wantedResponse.updateMany({ where: { wantedPostId: { in: ids }, status: "pending" }, data: { status: "expired" } }),
      prisma.marketItem.updateMany({ where: { sourceWantedPostId: { in: ids }, visibility: "targeted", status: "targeted" }, data: { status: "expired" } }),
    ]).catch(() => null);
  }

  await prisma.tradeIntent.updateMany({ where: { status: "pending", expiresAt: { lte: now } }, data: { status: "expired" } });

  const overdueSellerConfirmations = prisma.learningCommerceOrder
    ? await prisma.learningCommerceOrder.findMany({
      where: {
        status: "awaiting_seller_confirmation",
        sellerResponseDueAt: { lte: now },
      },
      select: { id: true, orderId: true },
      take: 100,
    })
    : [];
  for (const candidate of overdueSellerConfirmations) {
    await prisma.$transaction(async (tx: any) => {
      await acquireMarketOrderLock(tx, candidate.orderId);
      const current = await tx.learningCommerceOrder.findUnique({
        where: { id: candidate.id },
        include: {
          order: { select: { buyerId: true, sellerId: true, outTradeNo: true } },
        },
      });
      if (
        !current
        || current.status !== "awaiting_seller_confirmation"
        || !current.sellerResponseDueAt
        || current.sellerResponseDueAt > now
      ) {
        return false;
      }
      const transitioned = await tx.learningCommerceOrder.updateMany({
        where: {
          id: current.id,
          status: "awaiting_seller_confirmation",
          sellerResponseDueAt: { lte: now },
        },
        data: {
          status: "disputed",
          statusVersion: { increment: 1 },
          sellerResponseDueAt: null,
        },
      });
      if (transitioned.count !== 1) return false;
      await tx.marketOrder.update({
        where: { id: current.orderId },
        data: { status: "disputed", expiresAt: null },
      });
      const openIssue = await tx.learningOrderIssue.findFirst({
        where: {
          commerceOrderId: current.id,
          status: { in: ["open", "waiting_buyer", "waiting_seller", "refund_requested"] },
        },
        select: { id: true },
      });
      if (!openIssue) {
        await tx.learningOrderIssue.create({
          data: {
            commerceOrderId: current.id,
            requestedById: current.order.buyerId,
            type: "seller_confirmation_timeout",
            reason: "卖家未在规定时间内核对付款凭证",
            detail: "系统已将订单转入争议处理，请管理员核验付款凭证与双方说明。",
            slaDueAt: new Date(now.getTime() + LEARNING_ISSUE_SLA_MS),
            messages: {
              create: {
                kind: "system",
                content: "卖家确认已超时，系统自动转入争议处理并等待运营核验。",
              },
            },
          },
        });
      }
      const latestEvent = await tx.learningOrderEvent.aggregate({
        where: { commerceOrderId: current.id },
        _max: { sequence: true },
      });
      await tx.learningOrderEvent.create({
        data: {
          commerceOrderId: current.id,
          sequence: (latestEvent._max.sequence || 0) + 1,
          type: "SELLER_CONFIRMATION_TIMEOUT",
          fromStatus: "awaiting_seller_confirmation",
          toStatus: "disputed",
          detail: JSON.stringify({ sweptAt: now.toISOString() }),
        },
      });
      await tx.notification.createMany({
        data: [
          {
            userId: current.order.buyerId,
            category: "market",
            level: "strong",
            title: "学习资料订单已转入争议处理",
            content: `订单 ${current.order.outTradeNo} 的卖家未按时核对付款凭证，平台将介入处理。`,
            link: `/learning/orders/${current.id}`,
            source: "靠浦学习资料",
            payload: JSON.stringify({ type: "learning-seller-timeout", commerceOrderId: current.id }),
          },
          {
            userId: current.order.sellerId,
            category: "market",
            level: "strong",
            title: "学习资料订单确认已超时",
            content: `订单 ${current.order.outTradeNo} 已转入争议处理，请尽快补充说明。`,
            link: `/learning/orders/${current.id}`,
            source: "靠浦学习资料",
            payload: JSON.stringify({ type: "learning-seller-timeout", commerceOrderId: current.id }),
          },
        ],
      });
      return true;
    }).catch(() => false);
  }

  const overdueCompletions = prisma.learningCommerceOrder
    ? await prisma.learningCommerceOrder.findMany({
      where: {
        status: "delivered",
        completionDueAt: { lte: now },
        issues: {
          none: {
            status: { in: ["open", "waiting_buyer", "waiting_seller", "refund_requested"] },
          },
        },
      },
      select: { id: true, orderId: true },
      take: 100,
    })
    : [];
  for (const candidate of overdueCompletions) {
    await prisma.$transaction(async (tx: any) => {
      await acquireMarketOrderLock(tx, candidate.orderId);
      const current = await tx.learningCommerceOrder.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          orderId: true,
          status: true,
          completionDueAt: true,
          issues: {
            where: {
              status: { in: ["open", "waiting_buyer", "waiting_seller", "refund_requested"] },
            },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (
        !current
        || current.status !== "delivered"
        || !current.completionDueAt
        || current.completionDueAt > now
        || current.issues.length
      ) {
        return false;
      }
      const transitioned = await tx.learningCommerceOrder.updateMany({
        where: {
          id: current.id,
          status: "delivered",
          completionDueAt: { lte: now },
        },
        data: {
          status: "completed",
          statusVersion: { increment: 1 },
          completedAt: now,
          completionDueAt: null,
        },
      });
      if (transitioned.count !== 1) return false;
      await tx.marketOrder.update({
        where: { id: current.orderId },
        data: {
          status: "completed",
          buyerConfirmedAt: now,
          completedAt: now,
          closedAt: now,
          expiresAt: null,
        },
      });
      const latestEvent = await tx.learningOrderEvent.aggregate({
        where: { commerceOrderId: current.id },
        _max: { sequence: true },
      });
      await tx.learningOrderEvent.create({
        data: {
          commerceOrderId: current.id,
          sequence: (latestEvent._max.sequence || 0) + 1,
          type: "ORDER_AUTO_COMPLETED",
          fromStatus: "delivered",
          toStatus: "completed",
          detail: JSON.stringify({ sweptAt: now.toISOString() }),
        },
      });
      return true;
    }).catch(() => false);
  }

  return {
    reservations: closedReservations,
    listings: 0,
    wantedPosts: expiredWanted.length,
  };
}
