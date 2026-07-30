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
import {
  isMarketPrivateTradeStatus,
  MARKET_MESSAGE_PAGE_SIZE,
  marketConversationCreateSchema,
  marketConversationVisibilityWhere,
  marketMessageSchema,
  serializeMarketConversationItem,
} from "../src/services/marketConversationService";
import {
  marketAdminReportActionSchema,
  marketPositiveRateAdjustmentSchema,
  marketReviewSchema,
  marketSafetyRulePatchSchema,
  marketViolationCreateSchema,
} from "../src/services/marketGovernanceService";
import {
  MARKET_GOVERNANCE_LOCK_SCOPES,
  marketGovernanceLockKey,
} from "../src/services/marketGovernanceLockService";
import {
  marketPayoutProfileSchema,
  marketPreferenceSchema,
} from "../src/services/marketWorkspaceService";

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

test("stage 3 conversation contracts normalize messages and expose only physical private trades", () => {
  assert.deepEqual(marketConversationCreateSchema.parse({ message: "  约在北门  " }), { message: "约在北门" });
  assert.deepEqual(marketConversationCreateSchema.parse({}), { message: "" });
  assert.equal(marketMessageSchema.safeParse({ content: "   ", clientMessageId: "message-123" }).success, false);
  assert.equal(marketMessageSchema.safeParse({ content: "a".repeat(2001), clientMessageId: "message-123" }).success, false);
  assert.equal(marketMessageSchema.safeParse({ content: "确认北门见", clientMessageId: "message-123" }).success, true);
  assert.equal(marketMessageSchema.safeParse({ content: "", clientMessageId: "message-123", attachments: [{ url: "/uploads/a.jpg", mimeType: "image/jpeg" }] }).success, true);
  assert.equal(isMarketPrivateTradeStatus("negotiating"), true);
  assert.equal(isMarketPrivateTradeStatus("reserved"), true);
  assert.equal(isMarketPrivateTradeStatus("cancelled"), true);
  assert.equal(MARKET_MESSAGE_PAGE_SIZE, 50);
  assert.deepEqual(marketConversationVisibilityWhere(8), {
    orderId: { not: null },
    order: { status: { in: ["negotiating", "reserved", "paid", "delivering", "completed", "cancelled", "disputed", "no_show"] } },
    item: { deliveryType: "physical" },
    OR: [{ buyerId: 8 }, { sellerId: 8 }],
  });
});

test("stage 3 conversation item serialization cannot leak delivery or contact secrets", () => {
  const item = serializeMarketConversationItem({
    id: 12,
    sellerId: 4,
    listingType: "sell",
    title: "二手显示器",
    category: "digital",
    deliveryType: "physical",
    priceCents: 8800,
    status: "reserved",
    images: [{ id: 3, url: "/uploads/monitor.jpg", sort: 0 }],
    digitalDeliveryEncrypted: "must-not-leak",
    contactValue: "must-not-leak",
    description: "not-needed-in-conversation-list",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  });
  assert.equal(item.price, "88.00");
  assert.equal(item.cover, "/uploads/monitor.jpg");
  assert.equal("digitalDeliveryEncrypted" in item, false);
  assert.equal("contactValue" in item, false);
  assert.equal("description" in item, false);
});

test("stage 3 governance schemas reject ambiguous or empty moderation writes", () => {
  assert.deepEqual(marketReviewSchema.parse({ rating: 5, content: "  交易顺利  " }), {
    rating: 5,
    content: "交易顺利",
  });
  assert.equal(marketReviewSchema.safeParse({ rating: 0 }).success, false);
  assert.equal(marketSafetyRulePatchSchema.safeParse({}).success, false);
  assert.equal(marketAdminReportActionSchema.safeParse({
    status: "rejected",
    hideItem: true,
  }).success, false);
  assert.deepEqual(marketPositiveRateAdjustmentSchema.parse({
    positiveRate: 100,
    reason: "投诉核验后恢复",
    reportId: 9,
  }), {
    positiveRate: 100,
    reason: "投诉核验后恢复",
    reportId: 9,
  });
  assert.equal(marketPositiveRateAdjustmentSchema.safeParse({
    positiveRate: 101,
    reason: "越界",
  }).success, false);
  assert.equal(marketViolationCreateSchema.safeParse({
    userId: 2,
    itemId: 3,
    orderId: 4,
    type: "risk_trade",
    reason: "关联对象冲突",
  }).success, false);
});

test("stage 3 governance advisory locks isolate targets and state records", () => {
  const itemKey = marketGovernanceLockKey("reportItem", 7);
  const wantedKey = marketGovernanceLockKey("reportWanted", 7);
  const violationKey = marketGovernanceLockKey("violation", 7);
  assert.notEqual(itemKey, wantedKey);
  assert.notEqual(wantedKey, violationKey);
  assert.equal(
    itemKey,
    BigInt(MARKET_GOVERNANCE_LOCK_SCOPES.reportItem) * 4_294_967_296n + 7n,
  );
});

test("stage 3 workspace schemas keep preference and payout writes narrow", () => {
  assert.deepEqual(marketPreferenceSchema.parse({
    matchNotificationsEnabled: true,
  }), {
    matchNotificationsEnabled: true,
  });
  assert.equal(marketPreferenceSchema.safeParse({
    matchNotificationsEnabled: true,
    userId: 99,
  }).success, false);
  assert.deepEqual(marketPayoutProfileSchema.parse({
    method: "alipay",
    account: "  student@example.com  ",
    realName: "  测试同学  ",
  }), {
    method: "alipay",
    account: "student@example.com",
    realName: "测试同学",
  });
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

test("stage 3 routes enforce direct-chat privacy and expose trust administration", () => {
  const market = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const conversationRoute = readFileSync(new URL("../src/routes/marketConversation.ts", import.meta.url), "utf8");
  const conversationService = readFileSync(new URL("../src/services/marketConversationService.ts", import.meta.url), "utf8");
  const governanceRoute = readFileSync(new URL("../src/routes/marketGovernance.ts", import.meta.url), "utf8");
  const governanceService = readFileSync(new URL("../src/services/marketGovernanceService.ts", import.meta.url), "utf8");
  const workspaceRoute = readFileSync(new URL("../src/routes/marketWorkspace.ts", import.meta.url), "utf8");
  const workspaceService = readFileSync(new URL("../src/services/marketWorkspaceService.ts", import.meta.url), "utf8");
  const marketApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  const mine = readFileSync(new URL("../../web/src/views/market/Mine.vue", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../../web/src/views/admin/MarketPane.vue", import.meta.url), "utf8");
  assert.match(market, /marketRouter\.use\("\/", marketConversationRouter\)/);
  assert.doesNotMatch(conversationRoute, /contact-card|contact-cards/);
  assert.match(conversationRoute, /"\/conversations\/events"/);
  assert.match(conversationRoute, /"\/conversations\/unread-count"/);
  assert.match(conversationRoute, /"\/conversations\/:id\/confirm-completion"/);
  assert.match(conversationRoute, /"\/conversations\/:id\/read"/);
  assert.match(conversationRoute, /"\/conversations\/:id\/block"/);
  assert.match(conversationRoute, /"\/conversations\/:id\/messages\/:messageId\/report"/);
  assert.match(conversationRoute, /positiveRouteInteger\(req\.params\.id\)/);
  assert.match(conversationService, /status: "negotiating"/);
  assert.match(conversationService, /requireVerifiedMarketUser\(actor\.userId, actor\.role, "trade"\)/);
  assert.match(conversationService, /acquireMarketOrderLock/);
  assert.match(conversationService, /id: \{ in: unreadMessageIds \}/);
  assert.match(conversationService, /getMarketConversationUnreadSummary/);
  assert.match(conversationService, /confirmMarketConversationCompletion/);
  assert.match(conversationService, /deliveryType !== "physical"/);
  assert.doesNotMatch(marketApi, /canOpenMarketOrderContacts|saveContactCard|orderContactCards/);
  assert.doesNotMatch(mine, /联系方式|contactOpen|orderContacts/);
  assert.match(market, /marketRouter\.use\("\/", marketGovernanceRouter\)/);
  assert.match(governanceRoute, /marketGovernanceRouter\.get\("\/trust\/me"/);
  assert.match(governanceRoute, /"\/admin\/violations"/);
  assert.match(governanceRoute, /"\/admin\/action-logs"/);
  assert.match(governanceService, /acquireMarketOrderLock\(tx, orderId\)/);
  assert.match(governanceService, /acquireMarketGovernanceLock\(tx, "reportRecord", reportId\)/);
  assert.match(governanceService, /status: "pending"/);
  assert.match(governanceService, /hideMarketItemForReportInTransaction/);
  assert.match(marketApi, /request\.post<MarketReview>/);
  assert.match(marketApi, /request\.post<MarketReport>/);
  assert.match(market, /marketRouter\.use\("\/", marketWorkspaceRouter\)/);
  assert.match(workspaceRoute, /"\/items\/:id\/favorite"/);
  assert.match(workspaceRoute, /positiveRouteInteger\(req\.params\.id\)/);
  assert.match(workspaceService, /acquireMarketItemLock\(tx, itemId\)/);
  assert.match(workspaceService, /orders: orders\.map\(\(order\) =>/);
  assert.doesNotMatch(workspaceService, /prisma\.tradeIntent\.findMany/);
  assert.doesNotMatch(workspaceService, /prisma\.marketOffer\.findMany/);
  assert.match(workspaceService, /PRIVATE_FAVORITE_STATUSES\.includes\(item\.status\)/);
  assert.match(workspaceService, /status: \{ in: PUBLIC_PROFILE_ITEM_STATUSES \}/);
  assert.match(marketApi, /request\.get<MarketMineWorkspace>/);
  assert.match(marketApi, /request\.get<MarketPublicUserProfile>/);
  const profile = readFileSync(new URL("../../web/src/views/profile/Index.vue", import.meta.url), "utf8");
  assert.doesNotMatch(mine, /label="校园身份与信用"|name="trust"/);
  assert.match(profile, /id="trust"[\s\S]*t\("profile\.identity"\)/);
  assert.match(profile, /id="favorites"[\s\S]*t\("profile\.favorites"\)/);
  assert.match(admin, /信用处理与申诉/);
  assert.match(admin, /内容规则/);
});
