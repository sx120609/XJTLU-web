import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INTENT_LIFETIME_DAYS,
  RESERVATION_LIFETIME_HOURS,
  WANTED_LIFETIME_DAYS,
  nextIntentExpiry,
  nextReservationExpiry,
  nextWantedExpiry,
  sweepMarketLifecycle,
} from "../src/services/marketLifecycle";

test("wanted, intent and reservation lifecycle windows are deterministic and bounded", () => {
  const now = new Date("2026-07-18T00:00:00.000Z");
  assert.equal(nextWantedExpiry(now).getTime() - now.getTime(), WANTED_LIFETIME_DAYS * 86_400_000);
  assert.equal(nextIntentExpiry(now).getTime() - now.getTime(), INTENT_LIFETIME_DAYS * 86_400_000);
  assert.equal(nextReservationExpiry(now).getTime() - now.getTime(), RESERVATION_LIFETIME_HOURS * 3_600_000);
  const meetup = new Date("2026-07-30T00:00:00.000Z");
  assert.equal(nextReservationExpiry(now, meetup).toISOString(), "2026-07-31T00:00:00.000Z");
  const tooLate = new Date("2026-08-20T00:00:00.000Z");
  assert.equal(nextReservationExpiry(now, tooLate).toISOString(), "2026-08-01T00:00:00.000Z");
});

test("lifecycle sweep closes reservations and expires wants and intentions without expiring sale listings", async () => {
  const calls: Array<{ model: string; data: any; where: any }> = [];
  const record = (model: string) => async ({ where, data }: any) => { calls.push({ model, where, data }); return { count: 1 }; };
  const tx: any = {
    $queryRaw: async () => [{ locked: 1 }],
    marketOrder: {
      findUnique: async () => ({
        id: 1,
        itemId: 2,
        offerId: null,
        tradeIntentId: 3,
        wantedPostId: null,
        wantedResponseId: null,
        status: "reserved",
        expiresAt: new Date("2026-07-17T00:00:00.000Z"),
      }),
      updateMany: record("marketOrder"),
    },
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
    marketOrder: { findMany: async () => [{ id: 1 }] },
    marketItem: {
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
  assert.deepEqual(result, { reservations: 1, listings: 0, wantedPosts: 1 });
  assert.ok(calls.some((call) => call.model === "marketOrder" && call.data.status === "expired"));
  assert.ok(calls.some((call) => call.model === "marketItem" && call.data.status === "active"));
  assert.equal(calls.some((call) => call.model === "marketItem" && call.data.status === "expired" && call.where?.sourceWantedPostId === undefined), false);
  assert.ok(calls.some((call) => call.model === "wantedPost" && call.data.status === "expired"));
  assert.ok(calls.filter((call) => call.model === "tradeIntent" && call.data.status === "expired").length >= 2);
});

test("lifecycle sweep rechecks a reservation after locking before expiring it", async () => {
  let orderWrites = 0;
  const tx: any = {
    $queryRaw: async () => [{ locked: 1 }],
    marketOrder: {
      findUnique: async () => ({
        id: 1,
        itemId: 2,
        offerId: null,
        tradeIntentId: null,
        wantedPostId: null,
        wantedResponseId: null,
        status: "reserved",
        expiresAt: new Date("2026-07-20T00:00:00.000Z"),
      }),
      updateMany: async () => {
        orderWrites += 1;
        return { count: 1 };
      },
    },
  };
  const prisma: any = {
    marketOrder: { findMany: async () => [{ id: 1 }] },
    wantedPost: { findMany: async () => [] },
    tradeIntent: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (operation: any) => operation(tx),
  };
  const result = await sweepMarketLifecycle(
    prisma,
    new Date("2026-07-18T00:00:00.000Z"),
  );
  assert.equal(orderWrites, 0);
  assert.equal(result.reservations, 0);
});

test("current physical trade exposes direct chat, dual confirmation and moderation routes", () => {
  const market = [
    readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketItemWrite.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketWantedWrite.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketWantedResponse.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketConversation.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketOrder.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketAdmin.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketConversationService.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketItemWriteService.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketOrderFulfillmentService.ts", import.meta.url), "utf8"),
  ].join("\n");
  const rootMarketRoute = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../web/src/views/market/Detail.vue", import.meta.url), "utf8");
  const mine = readFileSync(new URL("../../web/src/views/market/Mine.vue", import.meta.url), "utf8");
  assert.match(market, /\w+Router\.post\(\s*"\/wanted"/);
  assert.match(market, /\w+Router\.post\(\s*"\/wanted\/:id\/responses"/);
  assert.match(market, /\w+Router\.post\(\s*"\/items\/:id\/conversations"/);
  assert.match(market, /\w+Router\.post\(\s*"\/conversations\/:id\/confirm-completion"/);
  assert.match(market, /\w+Router\.get\(\s*"\/conversations\/unread-count"/);
  assert.match(market, /status: "negotiating"/);
  assert.doesNotMatch(rootMarketRoute, /marketTradeRouter/);
  assert.match(market, /\w+Router\.patch\(\s*"\/orders\/:id"/);
  assert.match(market, /"buyer_confirm",[\s\S]*"seller_confirm",[\s\S]*"cancel"/);
  assert.doesNotMatch(market, /"set_meetup"/);
  assert.doesNotMatch(market, /"report_no_show"/);
  assert.match(market, /buyerConfirmedAt && updated\.sellerConfirmedAt/);
  assert.match(market, /physical_trade_buyer_completed/);
  assert.match(market, /physical_trade_seller_completed/);
  assert.match(market, /acquireMarketOrderLock\(tx, orderId\)/);
  assert.match(market, /\w+Router\.patch\(\s*"\/admin\/wanted\/:id"/);
  assert.match(market, /\["active", "expired", "withdrawn", "sold"\]\.includes\(current\.status\)/);
  assert.match(detail, /\['expired', 'withdrawn', 'sold'\]\.includes\(item\.status\)[^\n]+重新上架/);
  assert.match(mine, /const relistItemStatuses = \["expired", "withdrawn", "sold"\]/);
  assert.match(mine, /relistItemStatuses\.includes\(item\.status\)[^\n]+重新上架/);
  assert.match(mine, /\{ label: "全部", value: "all" \}[\s\S]*\{ label: "在售", value: "active" \}[\s\S]*\{ label: "已售出", value: "sold" \}[\s\S]*\{ label: "草稿", value: "draft" \}[\s\S]*\{ label: "已下架", value: "withdrawn" \}/);
  assert.doesNotMatch(mine, /联系方式|续期 21 天/);
  assert.match(router, /path: "market\/wanted\/:id"/);
  assert.match(router, /path: "market\/seller\/:id"/);
});
