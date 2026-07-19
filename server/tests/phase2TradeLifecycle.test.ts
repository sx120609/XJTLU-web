import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INTENT_LIFETIME_DAYS,
  LISTING_LIFETIME_DAYS,
  RESERVATION_LIFETIME_HOURS,
  WANTED_LIFETIME_DAYS,
  nextIntentExpiry,
  nextListingExpiry,
  nextReservationExpiry,
  nextWantedExpiry,
  sweepMarketLifecycle,
} from "../src/services/marketLifecycle";

test("stage 2 lifecycle windows are deterministic and bounded", () => {
  const now = new Date("2026-07-18T00:00:00.000Z");
  assert.equal(nextListingExpiry(now).getTime() - now.getTime(), LISTING_LIFETIME_DAYS * 86_400_000);
  assert.equal(nextWantedExpiry(now).getTime() - now.getTime(), WANTED_LIFETIME_DAYS * 86_400_000);
  assert.equal(nextIntentExpiry(now).getTime() - now.getTime(), INTENT_LIFETIME_DAYS * 86_400_000);
  assert.equal(nextReservationExpiry(now).getTime() - now.getTime(), RESERVATION_LIFETIME_HOURS * 3_600_000);
  const meetup = new Date("2026-07-30T00:00:00.000Z");
  assert.equal(nextReservationExpiry(now, meetup).toISOString(), "2026-07-31T00:00:00.000Z");
  const tooLate = new Date("2026-08-20T00:00:00.000Z");
  assert.equal(nextReservationExpiry(now, tooLate).toISOString(), "2026-08-01T00:00:00.000Z");
});

test("lifecycle sweep closes reservations and expires listings, wants and intentions idempotently", async () => {
  const calls: Array<{ model: string; data: any; where: any }> = [];
  const record = (model: string) => async ({ where, data }: any) => { calls.push({ model, where, data }); return { count: 1 }; };
  const tx: any = {
    marketOrder: { update: record("marketOrder") },
    marketOffer: { updateMany: record("marketOffer") },
    tradeIntent: { updateMany: record("tradeIntent") },
    wantedResponse: { updateMany: record("wantedResponse") },
    wantedPost: { updateMany: record("wantedPost") },
    marketItem: {
      findUnique: async () => ({ expiresAt: new Date("2026-08-01T00:00:00.000Z"), visibility: "public" }),
      updateMany: record("marketItem"),
    },
  };
  const prisma: any = {
    marketOrder: { findMany: async () => [{ id: 1, itemId: 2, offerId: null, tradeIntentId: 3, wantedPostId: null, wantedResponseId: null }] },
    marketItem: {
      findMany: async () => [{ id: 10 }],
      updateMany: record("marketItem"),
    },
    tradeIntent: { updateMany: record("tradeIntent") },
    wantedPost: {
      findMany: async () => [{ id: 20 }],
      updateMany: record("wantedPost"),
    },
    wantedResponse: { updateMany: record("wantedResponse") },
    $transaction: async (operation: any) => typeof operation === "function" ? operation(tx) : Promise.all(operation),
  };
  const result = await sweepMarketLifecycle(prisma, new Date("2026-07-18T00:00:00.000Z"));
  assert.deepEqual(result, { reservations: 1, listings: 1, wantedPosts: 1 });
  assert.ok(calls.some((call) => call.model === "marketOrder" && call.data.status === "expired"));
  assert.ok(calls.some((call) => call.model === "marketItem" && call.data.status === "active"));
  assert.ok(calls.some((call) => call.model === "wantedPost" && call.data.status === "expired"));
  assert.ok(calls.filter((call) => call.model === "tradeIntent" && call.data.status === "expired").length >= 2);
});

test("stage 2 exposes separate wanted, intent, reservation and moderation routes", () => {
  const market = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  assert.match(market, /marketRouter\.post\("\/wanted"/);
  assert.match(market, /marketRouter\.post\("\/wanted\/:id\/responses"/);
  assert.match(market, /marketRouter\.post\("\/items\/:id\/intents"/);
  assert.match(market, /status: "reserved"/);
  assert.match(market, /action: z\.enum\(\["set_meetup", "buyer_confirm", "seller_confirm", "cancel", "report_no_show"/);
  assert.match(market, /buyerConfirmedAt && updated\.sellerConfirmedAt/);
  assert.match(market, /marketRouter\.patch\("\/admin\/wanted\/:id"/);
  assert.match(router, /path: "market\/wanted\/:id"/);
  assert.match(router, /path: "market\/seller\/:id"/);
});
