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

test("learning material items match the unified learning-material wanted category", () => {
  const result = scoreMarketMatch({
    id: 3,
    sellerId: 10,
    title: "ECON101 期末复习资料",
    description: "知识点总结和模拟题",
    category: "digital_goods",
    priceCents: 1_990,
    condition: "good",
    campus: "SIP",
  }, {
    id: 4,
    authorId: 11,
    title: "求购 ECON101 复习资料",
    description: "需要期末知识点和练习题",
    category: "learning_materials",
    budgetMinCents: 1_000,
    budgetMaxCents: 3_000,
    condition: "",
    campus: "SIP",
  });
  assert.ok(result.score >= 60);
  assert.equal(result.reasons[0]?.key, "category");
  assert.equal(result.reasons.some((reason) => reason.key === "budget"), true);
});

test("matching and preferences remain while physical fulfillment uses direct chat", () => {
  const routes = [
    readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketCatalog.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketWantedCatalog.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketWorkspace.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketOrderFulfillmentService.ts", import.meta.url), "utf8"),
  ].join("\n");
  const workers = readFileSync(new URL("../src/runtime/backgroundWorkers.ts", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../web/src/views/market/Detail.vue", import.meta.url), "utf8");
  const wanted = readFileSync(new URL("../../web/src/views/market/WantedDetail.vue", import.meta.url), "utf8");
  const messages = readFileSync(new URL("../../web/src/views/market/Messages.vue", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../../web/src/views/profile/Index.vue", import.meta.url), "utf8");
  assert.match(routes, /\/items\/:id\/matches/);
  assert.match(routes, /\/wanted\/:id\/matches/);
  assert.match(routes, /\/preferences/);
  assert.doesNotMatch(workers, /startMarketReminderPoller/);
  assert.match(routes, /status: "negotiating"/);
  assert.match(detail, /matchingWanted/);
  assert.match(wanted, /matchingItems/);
  assert.match(profile, /求购与闲置匹配/);
  assert.match(messages, /实际成交后，请买卖双方分别确认/);
});
