import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateMarketTrustScore,
  ensureMarketAccess,
  evaluateMarketContent,
  maskMarketContact,
  openMarketContact,
  sanitizeAdminLogDetail,
  sealMarketContact,
} from "../src/services/marketTrust";

test("stage 3 market safety rules prioritize block over review and normalize whitespace", async () => {
  const prisma: any = {
    marketSafetyRule: {
      findMany: async () => [
        { id: 1, keyword: "微信", category: "contact_diversion", action: "review", note: "人工复核" },
        { id: 2, keyword: "处方药", category: "controlled_goods", action: "block", note: "禁售" },
      ],
    },
  };
  assert.deepEqual((await evaluateMarketContent(prisma, ["全新课本"])).action, "allow");
  assert.deepEqual((await evaluateMarketContent(prisma, ["可 加 我 微 信"])).action, "review");
  const blocked = await evaluateMarketContent(prisma, ["出 处方 药，也可微信联系"]);
  assert.equal(blocked.action, "block");
  assert.equal(blocked.matches.length, 2);
});

test("stage 3 contact cards are masked and encrypted independently from public profiles", () => {
  assert.equal(maskMarketContact("phone", "138-1234-5678"), "138****5678");
  assert.equal(maskMarketContact("email", "student@example.com"), "st***@example.com");
  assert.equal(maskMarketContact("wechat", "kaopu2026"), "ka***26");
  const encrypted = sealMarketContact("kaopu-private-contact");
  assert.notEqual(encrypted, "kaopu-private-contact");
  assert.equal(openMarketContact(encrypted), "kaopu-private-contact");
});

test("stage 3 trust scoring is bounded and penalizes no-shows and active violations", () => {
  const reliable = calculateMarketTrustScore({ identityVerified: true, completedTradeCount: 8, averageRating: 4.8, positiveReviewCount: 8, reviewCount: 8, noShowCount: 0, cancelledByUserCount: 0, activeViolations: [] });
  const risky = calculateMarketTrustScore({ identityVerified: true, completedTradeCount: 8, averageRating: 4.8, positiveReviewCount: 8, reviewCount: 8, noShowCount: 2, cancelledByUserCount: 3, activeViolations: [{ level: "serious" }] });
  assert.equal(reliable.score, 100);
  assert.equal(reliable.code, "excellent");
  assert.ok(risky.score < reliable.score);
  assert.ok(risky.score >= 0 && risky.score <= 100);
});

test("stage 3 restrictions expire before access checks and block active trade restrictions", async () => {
  let expired = false;
  const prisma: any = {
    marketViolation: {
      updateMany: async () => { expired = true; return { count: 1 }; },
      findFirst: async () => ({ id: 3, action: "restrict_trade", reason: "风险交易", expiresAt: null }),
    },
  };
  await assert.rejects(() => ensureMarketAccess(prisma, 7, "trade"), /市集交易功能已受限/);
  assert.equal(expired, true);
  await ensureMarketAccess(prisma, 7, "trade", "admin");
});

test("stage 3 admin audit detail removes sensitive contact and credential fields", () => {
  const safe = sanitizeAdminLogDetail({ action: "warn", phone: "13812345678", nested: { wechat: "secret", reason: "违规" }, token: "jwt" }) as any;
  assert.equal(safe.action, "warn");
  assert.equal(safe.phone, undefined);
  assert.equal(safe.token, undefined);
  assert.deepEqual(safe.nested, { reason: "违规" });
});

test("stage 3 routes enforce post-accept privacy and expose trust administration", () => {
  const market = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const mine = readFileSync(new URL("../../web/src/views/market/Mine.vue", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../../web/src/views/admin/MarketPane.vue", import.meta.url), "utf8");
  assert.match(market, /卖家接受购买意向后才开放交易会话/);
  assert.match(market, /marketRouter\.get\("\/orders\/:id\/contact-cards"/);
  assert.match(market, /conversationId: null/);
  assert.match(market, /marketRouter\.get\("\/trust\/me"/);
  assert.match(market, /marketRouter\.post\("\/admin\/violations"/);
  assert.match(market, /marketRouter\.get\("\/admin\/action-logs"/);
  assert.match(mine, /校园身份与信用/);
  assert.match(admin, /信用处理与申诉/);
  assert.match(admin, /内容规则/);
});
