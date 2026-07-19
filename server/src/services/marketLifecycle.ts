export const LISTING_LIFETIME_DAYS = 30;
export const WANTED_LIFETIME_DAYS = 21;
export const INTENT_LIFETIME_DAYS = 7;
export const RESERVATION_LIFETIME_HOURS = 72;

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addHours(from: Date, hours: number) {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export function nextListingExpiry(now = new Date()) {
  return addDays(now, LISTING_LIFETIME_DAYS);
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
    select: { id: true, itemId: true, offerId: true, tradeIntentId: true, wantedPostId: true, wantedResponseId: true },
    take: 100,
  });

  for (const reservation of expiredReservations) {
    await prisma.$transaction(async (tx: any) => {
      await tx.marketOrder.update({ where: { id: reservation.id }, data: { status: "expired", closedAt: now, cancelReason: "预约超时自动解除" } });
      if (reservation.offerId) await tx.marketOffer.updateMany({ where: { id: reservation.offerId }, data: { status: "expired" } });
      if (reservation.tradeIntentId) await tx.tradeIntent.updateMany({ where: { id: reservation.tradeIntentId }, data: { status: "expired" } });
      if (reservation.wantedResponseId) await tx.wantedResponse.updateMany({ where: { id: reservation.wantedResponseId }, data: { status: "expired" } });
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
    }).catch(() => null);
  }

  const expiredListings = await prisma.marketItem.findMany({
    where: { status: { in: ["active", "negotiating"] }, visibility: "public", expiresAt: { lte: now } },
    select: { id: true },
    take: 200,
  });
  if (expiredListings.length) {
    const ids = expiredListings.map((item: { id: number }) => item.id);
    await prisma.$transaction([
      prisma.marketItem.updateMany({ where: { id: { in: ids }, status: { in: ["active", "negotiating"] } }, data: { status: "expired" } }),
      prisma.tradeIntent.updateMany({ where: { itemId: { in: ids }, status: "pending" }, data: { status: "expired" } }),
    ]).catch(() => null);
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
  return {
    reservations: expiredReservations.length,
    listings: expiredListings.length,
    wantedPosts: expiredWanted.length,
  };
}
