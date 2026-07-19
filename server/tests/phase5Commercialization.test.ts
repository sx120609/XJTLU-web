import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ensurePromotionTransition,
  isPromotionOrderActive,
  nextPromotionWindow,
  promotionBadgeLabel,
  serializeItemPromotions,
} from "../src/services/promotion";

test("stage 5 promotion lifecycle only accepts a pending manual order once", () => {
  assert.equal(ensurePromotionTransition("pending", "confirmed"), "confirmed");
  assert.equal(ensurePromotionTransition("pending", "rejected"), "rejected");
  assert.throws(() => ensurePromotionTransition("confirmed", "rejected"), /PROMOTION_ORDER_NOT_PENDING/);

  const now = new Date("2026-07-18T00:00:00.000Z");
  const currentUntil = new Date("2026-07-20T00:00:00.000Z");
  const window = nextPromotionWindow(currentUntil, 7, now);
  assert.equal(window.startsAt.toISOString(), now.toISOString());
  assert.equal(window.expiresAt.toISOString(), "2026-07-27T00:00:00.000Z");
  assert.equal(isPromotionOrderActive({ status: "confirmed", startsAt: now, expiresAt: window.expiresAt }, now), true);
  assert.equal(isPromotionOrderActive({ status: "pending", startsAt: now, expiresAt: window.expiresAt }, now), false);
  assert.equal(serializeItemPromotions({
    pinnedUntil: window.expiresAt,
    pinnedPromotionOrder: { id: 1, status: "pending", startsAt: now, expiresAt: window.expiresAt },
  }, now).pinned, null);
});

test("stage 5 uses explicit labels for every commercial placement", () => {
  assert.deepEqual(
    ["listing_pin", "wanted_urgent", "home_featured", "merchant_homepage"].map(promotionBadgeLabel),
    ["置顶", "加急", "推广", "合作商户"],
  );
  const home = readFileSync(new URL("../../web/src/views/Home.vue", import.meta.url), "utf8");
  const market = readFileSync(new URL("../../web/src/views/market/Index.vue", import.meta.url), "utf8");
  const wanted = readFileSync(new URL("../../web/src/views/market/WantedList.vue", import.meta.url), "utf8");
  const promotionCenter = readFileSync(new URL("../../web/src/views/market/PromotionCenter.vue", import.meta.url), "utf8");
  const label = readFileSync(new URL("../../web/src/components/market/PromotionLabel.vue", import.meta.url), "utf8");
  assert.doesNotMatch(home, /SPONSORED|推广推荐/);
  assert.match(home, /item\.promotions\?\.pinned/);
  assert.doesNotMatch(home, /item\.promotion\?\.urgent/);
  assert.match(market, /PromotionLabel v-if="item\.promotions\.pinned"/);
  assert.match(wanted, /PromotionLabel v-if="post\.promotion\.urgent"/);
  assert.match(promotionCenter, /明确标注的展示服务/);
  assert.match(label, /promotion-label/);
});

test("stage 5 reads runtime prices from configurable plans and keeps payment manual", () => {
  const route = readFileSync(new URL("../src/routes/marketPromotions.ts", import.meta.url), "utf8");
  assert.match(route, /promotionPlan\.findUnique/);
  assert.match(route, /amountCents: plan\.priceCents/);
  assert.match(route, /paymentMode: "manual"/);
  assert.match(route, /promotionPlan\.update/);
  assert.doesNotMatch(route, /req\.headers\["x-forwarded-for"\]/);
  assert.doesNotMatch(route, /createEpay|submitMarketEpay|epayNotify|paymentUrl/);
  assert.doesNotMatch(route, /\b590\b|\b1290\b|\b2990\b/);
});

test("stage 5 migration is additive and includes analytics without raw visitor data", () => {
  const migration = readFileSync(new URL("../prisma/migrations/20260718050000_stage_5_promotions/migration.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  for (const table of ["MerchantProfile", "PromotionPlan", "PromotionOrder", "PromotionEvent"]) {
    assert.match(migration, new RegExp(`CREATE TABLE \\"${table}\\"`));
    assert.match(schema, new RegExp(`model ${table}`));
  }
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM "MarketItem"|DELETE FROM "WantedPost"/);
  assert.match(schema, /dedupeKey String/);
  assert.doesNotMatch(schema, /rawIp|ipAddress|userAgent/);
});

test("stage 5 unified search includes active merchants and preserves promotion labels", () => {
  const route = readFileSync(new URL("../src/routes/search.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../web/src/views/search/Result.vue", import.meta.url), "utf8");
  assert.match(route, /merchantProfile\.findMany/);
  assert.match(route, /serializeMerchantPromotion/);
  assert.match(page, /合作商户（/);
  assert.match(page, /PromotionLabel v-if="item\.promotions\.pinned"/);
  assert.match(page, /PromotionLabel v-if="post\.promotion\.urgent"/);
});
