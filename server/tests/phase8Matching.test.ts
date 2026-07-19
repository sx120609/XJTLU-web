import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scoreMarketMatch } from "../src/services/marketMatching";

test("phase 8 matching score is deterministic and explainable", () => {
  const result = scoreMarketMatch({
    id: 1,
    sellerId: 10,
    title: "索尼 WH-1000XM5 降噪耳机",
    description: "功能正常，可在 SIP 校区当面试听",
    category: "digital",
    priceCents: 150_000,
    condition: "good",
    campus: "SIP",
    brand: "Sony",
    model: "WH-1000XM5",
  }, {
    id: 2,
    authorId: 11,
    title: "求购索尼 XM5 降噪耳机",
    description: "希望功能正常，可以当面测试",
    category: "digital",
    budgetMinCents: 120_000,
    budgetMaxCents: 180_000,
    condition: "使用良好",
    campus: "SIP",
    brandModel: "Sony WH-1000XM5",
  });
  assert.equal(result.score, 100);
  assert.deepEqual(result.reasons.map((reason) => reason.key), ["category", "budget", "campus", "keyword", "condition"]);
  assert.equal(result.reasons.reduce((sum, reason) => sum + reason.points, 0), result.score);
});

test("phase 8 weak matches do not receive an unexplained score", () => {
  const result = scoreMarketMatch({
    id: 1, sellerId: 1, title: "篮球", description: "室外篮球", category: "sports", priceCents: 5_000, condition: "fair", campus: "SIP",
  }, {
    id: 2, authorId: 2, title: "求购显示器", description: "需要 4K", category: "digital", budgetMinCents: 80_000, budgetMaxCents: 120_000, condition: "全新", campus: "TC",
  });
  assert.equal(result.score, 0);
  assert.deepEqual(result.reasons, []);
});

test("phase 8 routes and mobile pages expose matching, preferences and fulfillment guidance", () => {
  const routes = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../web/src/views/market/Detail.vue", import.meta.url), "utf8");
  const wanted = readFileSync(new URL("../../web/src/views/market/WantedDetail.vue", import.meta.url), "utf8");
  const mine = readFileSync(new URL("../../web/src/views/market/Mine.vue", import.meta.url), "utf8");
  assert.match(routes, /\/items\/:id\/matches/);
  assert.match(routes, /\/wanted\/:id\/matches/);
  assert.match(routes, /\/preferences/);
  assert.match(routes, /meetupReminderSentAt: null/);
  assert.match(app, /startMarketReminderPoller/);
  assert.match(detail, /matchingWanted/);
  assert.match(wanted, /matchingItems/);
  assert.match(mine, /求购与闲置匹配/);
  assert.match(mine, /orderNextStep/);
});
