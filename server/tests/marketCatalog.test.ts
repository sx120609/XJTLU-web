import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  LEARNING_MATERIAL_CATEGORY,
  categoryBelongsToCatalog,
  isLearningMaterialCategory,
  resolveMarketCategoryBoundary,
  splitMarketCategories,
} from "../src/services/marketCatalog";
import {
  buildMarketMeta,
  ITEM_CONDITIONS,
  LISTING_TYPES,
  normalizeMarketTradeMode,
  serializeItem,
  TRADE_MODES,
} from "../src/services/marketCatalogService";
import { marketCatalogRouter } from "../src/routes/marketCatalog";
import { marketItemWriteRouter } from "../src/routes/marketItemWrite";
import { marketWantedCatalogRouter } from "../src/routes/marketWantedCatalog";
import { marketWantedWriteRouter } from "../src/routes/marketWantedWrite";
import { marketWantedResponseRouter } from "../src/routes/marketWantedResponse";
import { marketTradeRouter } from "../src/routes/marketTrade";
import { marketOrderRouter } from "../src/routes/marketOrder";
import { marketConversationRouter } from "../src/routes/marketConversation";
import { marketGovernanceRouter } from "../src/routes/marketGovernance";
import { marketWorkspaceRouter } from "../src/routes/marketWorkspace";
import { marketPaymentRouter } from "../src/routes/marketPayment";
import { marketAdminRouter } from "../src/routes/marketAdmin";
import {
  serializeWantedPost,
  serializeWantedResponse,
  visibleWantedResponses,
} from "../src/services/marketWantedService";
import {
  canManageWantedPost,
  marketWantedInputSchema,
  marketWantedLifecycleSchema,
  marketWantedPatchSchema,
} from "../src/services/marketWantedWriteService";
import {
  marketWantedResponseActionSchema,
  marketWantedResponseInputSchema,
} from "../src/services/marketWantedResponseService";
import {
  MARKET_WANTED_LOCK_SCOPE,
  marketWantedLockKey,
} from "../src/services/marketWantedLockService";
import { serializeMarketOrder } from "../src/services/marketOrderService";
import { sealMarketSensitive } from "../src/services/marketSensitiveService";
import {
  marketOfferInputSchema,
  marketTradeActionSchema,
  marketTradeIntentInputSchema,
  serializeMarketOffer,
  serializeTradeIntent,
} from "../src/services/marketTradeService";
import {
  MARKET_ITEM_LOCK_SCOPE,
  marketItemLockKey,
} from "../src/services/marketItemLockService";
import {
  canManageMarketItem,
  marketItemInputSchema,
  marketItemLifecycleSchema,
  marketItemPatchSchema,
  marketItemStatusClosesPendingInterest,
} from "../src/services/marketItemWriteService";
import {
  marketOrderActionSchema,
} from "../src/services/marketOrderFulfillmentService";
import {
  MARKET_ORDER_LOCK_SCOPE,
  marketOrderLockKey,
} from "../src/services/marketOrderLockService";
import { prisma } from "../src/prisma";
import { errorHandler } from "../src/middleware/error";
import { signToken } from "../src/utils/jwt";

test("learning materials use one stable backend category", () => {
  assert.equal(LEARNING_MATERIAL_CATEGORY, "digital_goods");
  assert.equal(isLearningMaterialCategory("digital_goods"), true);
  assert.equal(isLearningMaterialCategory("books"), false);
});

test("ordinary marketplace excludes learning materials by default", () => {
  assert.deepEqual(resolveMarketCategoryBoundary("market"), {
    valid: true,
    filter: { not: "digital_goods" },
  });
  assert.deepEqual(resolveMarketCategoryBoundary("market", "books"), {
    valid: true,
    filter: "books",
  });
  assert.equal(resolveMarketCategoryBoundary("market", "digital_goods").valid, false);
});

test("learning materials endpoint is locked to its own category", () => {
  assert.deepEqual(resolveMarketCategoryBoundary("learning_materials"), {
    valid: true,
    filter: "digital_goods",
  });
  assert.deepEqual(resolveMarketCategoryBoundary("learning_materials", "digital_goods"), {
    valid: true,
    filter: "digital_goods",
  });
  assert.equal(resolveMarketCategoryBoundary("learning_materials", "books").valid, false);
});

test("publish catalog must match the selected category", () => {
  assert.equal(categoryBelongsToCatalog("market", "books"), true);
  assert.equal(categoryBelongsToCatalog("market", "digital_goods"), false);
  assert.equal(categoryBelongsToCatalog("learning_materials", "digital_goods"), true);
  assert.equal(categoryBelongsToCatalog("learning_materials", "digital"), false);
});

test("category metadata is split without duplicating or losing categories", () => {
  const categories = [
    { slug: "digital", name: "数码 3C" },
    { slug: "digital_goods", name: "电子资料" },
    { slug: "books", name: "教材书籍" },
  ];
  const result = splitMarketCategories(categories);
  assert.deepEqual(result.market.map((category) => category.slug), ["digital", "books"]);
  assert.equal(result.learningMaterials?.slug, "digital_goods");
  assert.equal(result.market.length + Number(Boolean(result.learningMaterials)), categories.length);
});

test("public market metadata keeps the server and web contract aligned", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  const category = (id: number, slug: string, fulfillmentType = "physical") => ({
    id,
    slug,
    name: slug,
    icon: "📦",
    description: "",
    fulfillmentType,
    imageRequired: fulfillmentType === "physical",
    enabled: true,
    sort: id,
    createdAt: now,
    updatedAt: now,
  });
  const meta = buildMarketMeta(
    [category(1, "books"), category(2, LEARNING_MATERIAL_CATEGORY, "digital")],
    { commissionBps: 0, learningMaterialCommissionBps: 0, updatedAt: now },
  );

  assert.deepEqual(meta.categories.map((entry) => entry.slug), ["books"]);
  assert.deepEqual(meta.wantedCategories.map((entry) => entry.slug), ["books", "learning_materials"]);
  assert.equal(meta.wantedCategories.at(-1)?.special, true);
  assert.equal(meta.wantedCategories.at(-1)?.fulfillmentType, "digital");
  assert.deepEqual(meta.campuses, ["SIP", "TC"]);
  assert.deepEqual(meta.conditions, ITEM_CONDITIONS);
  assert.deepEqual(meta.tradeModes, TRADE_MODES);
  assert.deepEqual(meta.listingTypes, LISTING_TYPES);
  assert.deepEqual(meta.payTypes, []);
  assert.equal(meta.paymentEnabled, false);
  assert.equal(meta.commissionRate, 0);
  assert.equal(meta.updatedAt, now);

  const webApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  assert.match(webApi, /export interface MarketMeta/);
  assert.match(webApi, /wantedCategories: MarketCategoryOption\[\]/);
  assert.match(webApi, /listingTypes: MarketListingType\[\]/);
  assert.match(webApi, /request\.get<MarketMeta>\("\/market\/meta"/);
});

test("public item serialization preserves legacy aliases and hides encrypted delivery", () => {
  const item = serializeItem({
    id: 7,
    sellerId: 3,
    listingType: "sell",
    title: "二手显示器",
    description: "使用正常",
    category: "digital",
    deliveryType: "physical",
    digitalDeliveryEncrypted: "must-not-leak",
    priceCents: 39900,
    originalPriceCents: null,
    negotiable: true,
    condition: "good",
    tradeMode: "both",
    campus: "SIP",
    location: "中心楼",
    status: "active",
    viewCount: 8,
    images: [{ id: 1, url: "/uploads/monitor.png", sort: 0 }],
    favorites: [{ userId: 9 }],
    seller: { id: 3, nickname: "卖家" },
    _count: { favorites: 2, offers: 4, tradeIntents: 1, conversations: 1 },
    createdAt: new Date("2026-07-28T00:00:00.000Z"),
    updatedAt: new Date("2026-07-28T00:00:00.000Z"),
  }, 9);

  assert.equal(item.price, "399.00");
  assert.equal(item.tradeMode, normalizeMarketTradeMode("both"));
  assert.equal(item.cover, "/uploads/monitor.png");
  assert.equal(item.favoriteCount, 2);
  assert.equal(item.offerCount, 1);
  assert.equal(item.favorited, true);
  assert.equal(item.hasDigitalDelivery, true);
  assert.equal("digitalDeliveryEncrypted" in item, false);
});

test("wanted serialization keeps anonymous identity, moderation and responses viewer-scoped", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  const post = {
    id: 41,
    authorId: 7,
    title: "求购显示器",
    category: "digital",
    budgetMinCents: 30000,
    budgetMaxCents: 60000,
    isAnonymous: true,
    anonymousAlias: "匿名同学 A7",
    moderationNote: "仅作者可见",
    moderatedAt: now,
    author: { id: 7, nickname: "不得泄露", avatar: "/private.png", role: "user" },
    linkedTopics: [{ id: 88 }],
    _count: { responses: 2 },
    urgentPromotionOrder: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  const publicPost = serializeWantedPost(post, 9);
  assert.equal(publicPost.authorId, null);
  assert.deepEqual(publicPost.author, {
    id: null,
    nickname: "匿名同学 A7",
    avatar: null,
    role: "anonymous",
    studentSso: false,
    anonymous: true,
  });
  assert.equal(publicPost.budgetMin, "300.00");
  assert.equal(publicPost.budgetMax, "600.00");
  assert.equal(publicPost.responseCount, 2);
  assert.equal(publicPost.mine, false);
  assert.equal(publicPost.moderationNote, undefined);
  assert.equal(publicPost.moderatedAt, undefined);
  assert.equal(publicPost.topicId, 88);
  assert.equal(publicPost.topicUrl, "/forum/topic/88");

  const ownerPost = serializeWantedPost(post, 7);
  assert.equal(ownerPost.mine, true);
  assert.equal(ownerPost.moderationNote, "仅作者可见");
  assert.equal(ownerPost.moderatedAt, now);

  const responses = [{ id: 1, sellerId: 9 }, { id: 2, sellerId: 10 }];
  assert.deepEqual(visibleWantedResponses(responses, 7, undefined, undefined), []);
  assert.deepEqual(visibleWantedResponses(responses, 7, 9, "user").map((row) => row.id), [1]);
  assert.deepEqual(visibleWantedResponses(responses, 7, 7, "user").map((row) => row.id), [1, 2]);
  assert.deepEqual(visibleWantedResponses(responses, 7, 99, "mod").map((row) => row.id), [1, 2]);

  const response = serializeWantedResponse({
    id: 1,
    sellerId: 9,
    priceCents: 45000,
    wantedPost: post,
    item: {
      id: 5,
      sellerId: 9,
      listingType: "sell",
      title: "显示器",
      description: "正常使用",
      category: "digital",
      deliveryType: "physical",
      priceCents: 45000,
      originalPriceCents: null,
      negotiable: false,
      condition: "good",
      tradeMode: "meetup",
      campus: "SIP",
      location: "中心楼",
      status: "active",
      viewCount: 0,
      images: [],
      _count: { favorites: 0, tradeIntents: 0 },
      createdAt: now,
      updatedAt: now,
    },
  });
  assert.equal(response.price, "450.00");
  assert.equal(response.item.price, "450.00");
  assert.equal(response.wantedPost.authorId, null);
  assert.equal(response.wantedPost.author.nickname, "匿名同学 A7");
  assert.equal(response.wantedPost.moderationNote, undefined);
});

test("wanted write schemas keep create, patch, lifecycle and web contracts aligned", () => {
  const create = marketWantedInputSchema.parse({
    title: "求购一台显示器",
    category: "digital",
    budgetMin: 300,
    budgetMax: 600,
    expectedTradeTime: "本周末",
    campus: "太仓",
    location: "教学楼大厅",
    description: "希望功能正常，可以现场测试。",
  });
  assert.equal(create.campus, "TC");
  assert.equal(create.anonymous, false);
  assert.equal(create.allowSellerOffers, true);
  assert.equal(create.expiryDays, 21);

  const patch = marketWantedPatchSchema.parse({
    title: "更新后的求购标题",
    anonymous: true,
  });
  assert.equal(patch.title, "更新后的求购标题");
  assert.equal("anonymous" in patch, false);
  assert.equal(marketWantedLifecycleSchema.parse({ action: "cancel" }).action, "cancel");
  assert.equal(marketWantedLifecycleSchema.safeParse({ action: "renew" }).success, false);
  assert.equal(marketWantedLifecycleSchema.safeParse({ action: "accept" }).success, false);

  assert.equal(canManageWantedPost(7, { userId: 7, role: "user" }), true);
  assert.equal(canManageWantedPost(7, { userId: 8, role: "user" }), false);
  assert.equal(canManageWantedPost(7, { userId: 8, role: "mod" }), true);

  const webApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  const publishView = readFileSync(new URL("../../web/src/views/market/WantedPublish.vue", import.meta.url), "utf8");
  assert.match(webApi, /expectedTradeTime: string/);
  assert.match(webApi, /campus: MarketCampus/);
  assert.match(webApi, /export type WantedPostPatch = Partial<Omit<WantedPostInput, "anonymous">>/);
  assert.match(webApi, /updateWantedPost: \(id: number, payload: WantedPostPatch\)/);
  assert.match(publishView, /anonymous: _anonymous/);
});

test("wanted response schemas, order privacy and web actions share one contract", () => {
  const input = marketWantedResponseInputSchema.parse({
    title: "二手显示器",
    price: "450",
    description: "功能正常，可当面测试。",
    images: ["/uploads/monitor.png"],
    availableTime: "周六下午",
  });
  assert.equal(input.condition, "good");
  assert.equal(input.brand, "");
  assert.equal(input.model, "");
  assert.deepEqual(input.images, ["/uploads/monitor.png"]);
  assert.equal(marketWantedResponseInputSchema.safeParse({
    price: 450,
    description: "功能正常",
    images: ["javascript:alert(1)"],
    availableTime: "周六下午",
  }).success, false);
  assert.equal(marketWantedResponseActionSchema.safeParse({ action: "accept" }).success, false);
  assert.equal(marketWantedResponseActionSchema.parse({ action: "reject" }).action, "reject");
  assert.equal(marketWantedResponseActionSchema.safeParse({ action: "complete" }).success, false);

  const encrypted = sealMarketSensitive("仅交易双方可见");
  const order = {
    id: 3,
    buyerId: 7,
    sellerId: 9,
    status: "reserved",
    amountCents: 45000,
    platformFeeCents: 0,
    sellerAmountCents: 45000,
    digitalDeliveryEncrypted: encrypted,
    meetupReminderSentAt: new Date(),
  };
  const reserved = serializeMarketOrder(order, 7, "user");
  assert.equal(reserved.amount, "450.00");
  assert.equal(reserved.platformFee, "0.00");
  assert.equal(reserved.digitalDelivery, null);
  assert.equal("digitalDeliveryEncrypted" in reserved, false);
  assert.equal("meetupReminderSentAt" in reserved, false);
  const paid = serializeMarketOrder({ ...order, status: "paid" }, 7, "user");
  assert.equal(paid.digitalDelivery, "仅交易双方可见");
  const stranger = serializeMarketOrder({ ...order, status: "paid" }, 12, "user");
  assert.equal(stranger.digitalDelivery, null);

  const expectedLockKey = BigInt(MARKET_WANTED_LOCK_SCOPE) * 4_294_967_296n + 41n;
  assert.equal(marketWantedLockKey(41), expectedLockKey);
  assert.notEqual(marketWantedLockKey(41), marketWantedLockKey(42));

  const service = readFileSync(new URL("../src/services/marketWantedResponseService.ts", import.meta.url), "utf8");
  const webApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  const wantedDetail = readFileSync(new URL("../../web/src/views/market/WantedDetail.vue", import.meta.url), "utf8");
  assert.match(service, /acquireMarketWantedLock\(tx, wantedPostId\)/);
  assert.match(service, /acquireMarketWantedLock\(tx, reference\.wantedPostId\)/);
  assert.match(webApi, /export interface WantedResponseInput/);
  assert.match(webApi, /export type WantedResponseAction = "reject" \| "cancel"/);
  assert.match(webApi, /respondToWanted: \(id: number, payload: WantedResponseInput\)/);
  assert.match(wantedDetail, /startResponseChat\(response/);
  assert.match(wantedDetail, /marketApi\.createConversation\(/);
});

test("legacy intent contracts remain readable while the live product uses direct chat", () => {
  const intent = marketTradeIntentInputSchema.parse({
    price: "88",
    availableTime: "工作日 18:00 后",
  });
  assert.equal(intent.message, "");
  assert.equal(intent.availableTime, "工作日 18:00 后");
  const offer = marketOfferInputSchema.parse({ price: 88 });
  assert.equal(offer.message, "");
  assert.equal(marketTradeActionSchema.parse({ action: "cancel" }).action, "cancel");
  assert.equal(marketTradeActionSchema.safeParse({ action: "complete" }).success, false);

  const serializedIntent = serializeTradeIntent({
    id: 1,
    proposedPriceCents: 8800,
    status: "pending",
  });
  assert.equal(serializedIntent.price, "88.00");
  const serializedOffer = serializeMarketOffer({
    id: 2,
    priceCents: 7600,
    status: "pending",
  });
  assert.equal(serializedOffer.price, "76.00");

  const expectedLockKey = BigInt(MARKET_ITEM_LOCK_SCOPE) * 4_294_967_296n + 51n;
  assert.equal(marketItemLockKey(51), expectedLockKey);
  assert.notEqual(marketItemLockKey(51), marketItemLockKey(52));

  const service = readFileSync(new URL("../src/services/marketConversationService.ts", import.meta.url), "utf8");
  const marketRoute = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const wantedResponseService = readFileSync(new URL("../src/services/marketWantedResponseService.ts", import.meta.url), "utf8");
  const itemWriteService = readFileSync(new URL("../src/services/marketItemWriteService.ts", import.meta.url), "utf8");
  const webApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../web/src/views/market/Detail.vue", import.meta.url), "utf8");
  assert.match(service, /acquireMarketItemLock\(tx, itemId\)/);
  assert.match(service, /status: "negotiating"/);
  assert.match(service, /tx\.marketConversation\.upsert/);
  assert.doesNotMatch(marketRoute, /marketTradeRouter/);
  assert.match(wantedResponseService, /acquireMarketItemLock\(tx, response\.itemId\)/);
  assert.match(itemWriteService, /acquireMarketItemLock\(tx, itemId\)/);
  assert.match(webApi, /export interface MarketTradeIntentInput/);
  assert.match(webApi, /export interface MarketOfferInput/);
  assert.match(webApi, /createConversation: \(itemId: number/);
  assert.match(detail, /@click="startChat">发起私聊/);
  assert.doesNotMatch(detail, /MarketTradeIntentInput/);
});

test("ordinary item write schemas, state guards and web contracts share one boundary", () => {
  const created = marketItemInputSchema.parse({
    listingType: "sell",
    title: "九成新显示器",
    description: "宿舍自用，功能正常",
    category: "digital",
    price: 450,
    condition: "good",
    tradeMode: "meetup",
  });
  assert.equal(created.catalog, "market");
  assert.equal(created.draft, false);
  assert.equal(created.campus, "");
  assert.equal(
    marketItemPatchSchema.safeParse({ status: "reserved" }).success,
    false,
  );
  assert.equal(
    marketItemPatchSchema.safeParse({ status: "deleted" }).success,
    false,
  );
  assert.equal(
    marketItemLifecycleSchema.parse({ action: "mark_sold" }).action,
    "mark_sold",
  );
  assert.equal(
    marketItemLifecycleSchema.safeParse({ action: "delete" }).success,
    false,
  );
  assert.equal(canManageMarketItem(7, { userId: 7, role: "user" }), true);
  assert.equal(canManageMarketItem(7, { userId: 8, role: "user" }), false);
  assert.equal(canManageMarketItem(7, { userId: 8, role: "mod" }), true);
  assert.equal(marketItemStatusClosesPendingInterest("active"), false);
  assert.equal(marketItemStatusClosesPendingInterest("draft"), true);
  assert.equal(marketItemStatusClosesPendingInterest("hidden"), true);

  const route = readFileSync(new URL("../src/routes/marketItemWrite.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/marketItemWriteService.ts", import.meta.url), "utf8");
  const orderService = readFileSync(new URL("../src/services/marketOrderFulfillmentService.ts", import.meta.url), "utf8");
  const marketRoute = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const webApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  assert.ok(marketItemWriteRouter);
  assert.match(route, /positiveRouteInteger\(req\.params\.id\)/);
  assert.match(service, /findActiveMarketItemOrder\(tx, itemId\)/);
  assert.match(service, /tx\.tradeIntent\.updateMany/);
  assert.match(service, /tx\.marketOffer\.updateMany/);
  assert.match(service, /tx\.wantedResponse\.updateMany/);
  assert.match(service, /hideMarketItemForReport/);
  assert.match(orderService, /item\.status === "hidden"/);
  assert.match(marketRoute, /marketRouter\.use\("\/", marketItemWriteRouter\)/);
  assert.doesNotMatch(marketRoute, /marketRouter\.post\("\/items"/);
  assert.match(webApi, /export type MarketItemStatus =/);
  assert.match(webApi, /export type MarketItemLifecycleAction =/);
  assert.match(webApi, /payload: MarketItemPatchInput/);
  assert.match(webApi, /request\.patch<MarketItem>/);
});

test("order fulfillment schema, route, lock and web contract share one state boundary", () => {
  const confirm = marketOrderActionSchema.parse({ action: "buyer_confirm" });
  assert.equal(confirm.action, "buyer_confirm");
  assert.equal(marketOrderActionSchema.safeParse({ action: "set_meetup" }).success, false);
  assert.equal(marketOrderActionSchema.safeParse({ action: "report_no_show" }).success, false);
  assert.equal(
    marketOrderActionSchema.safeParse({ action: "force_complete" }).success,
    false,
  );

  const expectedLockKey = BigInt(MARKET_ORDER_LOCK_SCOPE) * 4_294_967_296n + 61n;
  assert.equal(marketOrderLockKey(61), expectedLockKey);
  assert.notEqual(marketOrderLockKey(61), marketOrderLockKey(62));

  const route = readFileSync(new URL("../src/routes/marketOrder.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/marketOrderFulfillmentService.ts", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../src/services/marketLifecycle.ts", import.meta.url), "utf8");
  const workers = readFileSync(new URL("../src/runtime/backgroundWorkers.ts", import.meta.url), "utf8");
  const webApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  assert.ok(marketOrderRouter);
  assert.match(route, /positiveRouteInteger\(req\.params\.id\)/);
  assert.match(service, /acquireMarketOrderLock\(tx, orderId\)/);
  assert.match(service, /buyerConfirmedAt && updated\.sellerConfirmedAt/);
  assert.match(service, /tx\.marketRefund\.create/);
  assert.match(service, /tx\.marketOffer\.updateMany/);
  assert.match(lifecycle, /acquireMarketOrderLock\(tx, candidate\.id\)/);
  assert.match(lifecycle, /status: \{ in: \["reserved", "pending_payment"\] \}/);
  assert.doesNotMatch(workers, /startMarketReminderPoller/);
  assert.match(webApi, /export type MarketOrderAction =/);
  assert.match(webApi, /payload: MarketOrderUpdateInput/);
  assert.match(webApi, /MarketOrderActionResult/);
});

test("public market metadata route keeps the existing HTTP envelope and URL", async (t) => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  const categoryMethods = prisma.marketCategory as any;
  const configMethods = prisma.marketConfig as any;
  const originalCategoryUpsert = categoryMethods.upsert;
  const originalCategoryFindMany = categoryMethods.findMany;
  const originalConfigUpsert = configMethods.upsert;
  categoryMethods.upsert = async ({ create }: any) => ({ id: create.sort, ...create, createdAt: now, updatedAt: now });
  categoryMethods.findMany = async () => [{
    id: 1,
    slug: "books",
    name: "教材书籍",
    icon: "📚",
    description: "教材",
    fulfillmentType: "physical",
    imageRequired: true,
    enabled: true,
    sort: 20,
    createdAt: now,
    updatedAt: now,
  }];
  configMethods.upsert = async () => ({
    id: 1,
    commissionBps: 0,
    learningMaterialCommissionBps: 0,
    createdAt: now,
    updatedAt: now,
  });
  t.after(() => {
    categoryMethods.upsert = originalCategoryUpsert;
    categoryMethods.findMany = originalCategoryFindMany;
    configMethods.upsert = originalConfigUpsert;
  });

  const app = express();
  app.use("/api/market", marketCatalogRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/api/market/meta`);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.code, 0);
  assert.equal(body.message, "");
  assert.deepEqual(body.data.categories.map((entry: any) => entry.slug), ["books"]);
  assert.deepEqual(body.data.campuses, ["SIP", "TC"]);
  assert.equal(body.data.paymentEnabled, false);
});

test("public wanted matching route keeps the existing HTTP envelope and explainable match", async (t) => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  const wantedMethods = prisma.wantedPost as any;
  const itemMethods = prisma.marketItem as any;
  const originalWantedFindUnique = wantedMethods.findUnique;
  const originalItemFindMany = itemMethods.findMany;
  const wantedPost = {
    id: 41,
    authorId: 7,
    title: "求购显示器",
    description: "希望正常使用",
    category: "digital",
    budgetMinCents: 30000,
    budgetMaxCents: 60000,
    condition: "使用良好",
    campus: "SIP",
    location: "中心楼",
    brandModel: "24 英寸",
    status: "active",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };
  const item = {
    id: 5,
    sellerId: 9,
    listingType: "sell",
    title: "24 英寸显示器",
    description: "功能正常",
    category: "digital",
    deliveryType: "physical",
    priceCents: 45000,
    originalPriceCents: null,
    negotiable: false,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "中心楼",
    visibility: "public",
    status: "active",
    viewCount: 0,
    images: [],
    favorites: [],
    _count: { favorites: 0, offers: 0, tradeIntents: 0 },
    createdAt: now,
    updatedAt: now,
  };
  wantedMethods.findUnique = async ({ select }: any) => select
    ? { id: wantedPost.id, status: wantedPost.status }
    : wantedPost;
  itemMethods.findMany = async () => [item];
  t.after(() => {
    wantedMethods.findUnique = originalWantedFindUnique;
    itemMethods.findMany = originalItemFindMany;
  });

  const app = express();
  app.use("/api/market", marketWantedCatalogRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/api/market/wanted/41/matches`);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.code, 0);
  assert.equal(body.message, "");
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].item.id, 5);
  assert.ok(body.data[0].score >= 40);
  assert.deepEqual(
    body.data[0].reasons.slice(0, 3).map((reason: any) => reason.key),
    ["category", "budget", "campus"],
  );

  const webApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  assert.match(webApi, /export interface WantedListParams/);
  assert.match(webApi, /status\?: Extract<WantedPost\["status"\], "active" \| "responded">/);
  assert.match(webApi, /wanted: \(params\?: WantedListParams/);
});

test("market write routes require authentication and reject malformed ids before Prisma", async (t) => {
  const userMethods = prisma.user as any;
  const originalUserFindUnique = userMethods.findUnique;
  userMethods.findUnique = async () => ({
    id: 9,
    username: "test",
    role: "user",
    status: "active",
  });
  t.after(() => {
    userMethods.findUnique = originalUserFindUnique;
  });

  const app = express();
  app.use(express.json());
  app.use("/api/market", marketItemWriteRouter);
  app.use("/api/market", marketWantedWriteRouter);
  app.use("/api/market", marketWantedResponseRouter);
  app.use("/api/market", marketTradeRouter);
  app.use("/api/market", marketOrderRouter);
  app.use("/api/market", marketConversationRouter);
  app.use("/api/market", marketGovernanceRouter);
  app.use("/api/market", marketWorkspaceRouter);
  app.use("/api/market", marketPaymentRouter);
  app.use("/api/market", marketAdminRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const { port } = server.address() as AddressInfo;
  const unauthenticated = await fetch(`http://127.0.0.1:${port}/api/market/wanted`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(unauthenticated.status, 401);

  const token = signToken({ userId: 9, studentId: "test", role: "user", campus: "SIP" });
  const invalidPaymentId = await fetch(`http://127.0.0.1:${port}/api/market/orders/not-a-number/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ payType: "alipay" }),
  });
  assert.equal(invalidPaymentId.status, 400);
  const invalidPaymentBody = await invalidPaymentId.json() as any;
  assert.equal(invalidPaymentBody.code, 4000);
  assert.equal(invalidPaymentBody.message, "订单 ID 不合法");

  const invalidAdminCategoryId = await fetch(`http://127.0.0.1:${port}/api/market/admin/categories/not-a-number`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(invalidAdminCategoryId.status, 400);
  const invalidAdminCategoryBody = await invalidAdminCategoryId.json() as any;
  assert.equal(invalidAdminCategoryBody.code, 4000);
  assert.equal(invalidAdminCategoryBody.message, "品类 ID 不合法");

  const invalidId = await fetch(`http://127.0.0.1:${port}/api/market/wanted/not-a-number/lifecycle`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "cancel" }),
  });
  assert.equal(invalidId.status, 400);
  const body = await invalidId.json() as any;
  assert.equal(body.code, 4000);
  assert.equal(body.message, "求购 ID 不合法");

  const invalidItemId = await fetch(`http://127.0.0.1:${port}/api/market/items/not-a-number`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: "draft" }),
  });
  assert.equal(invalidItemId.status, 400);
  const invalidItemBody = await invalidItemId.json() as any;
  assert.equal(invalidItemBody.code, 4000);
  assert.equal(invalidItemBody.message, "商品 ID 不合法");

  const invalidWantedResponseId = await fetch(`http://127.0.0.1:${port}/api/market/wanted/not-a-number/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: "二手显示器",
      price: 450,
      description: "功能正常",
      images: ["/uploads/monitor.png"],
      availableTime: "周六下午",
    }),
  });
  assert.equal(invalidWantedResponseId.status, 400);
  const invalidWantedResponseBody = await invalidWantedResponseId.json() as any;
  assert.equal(invalidWantedResponseBody.code, 4000);
  assert.equal(invalidWantedResponseBody.message, "求购 ID 不合法");

  const invalidResponseActionId = await fetch(`http://127.0.0.1:${port}/api/market/wanted-responses/not-a-number`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "cancel" }),
  });
  assert.equal(invalidResponseActionId.status, 400);
  const invalidResponseActionBody = await invalidResponseActionId.json() as any;
  assert.equal(invalidResponseActionBody.code, 4000);
  assert.equal(invalidResponseActionBody.message, "求购响应 ID 不合法");

  const invalidTradeItemId = await fetch(`http://127.0.0.1:${port}/api/market/items/not-a-number/intents`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      price: 88,
      availableTime: "工作日晚上",
    }),
  });
  assert.equal(invalidTradeItemId.status, 400);
  const invalidTradeItemBody = await invalidTradeItemId.json() as any;
  assert.equal(invalidTradeItemBody.code, 4000);
  assert.equal(invalidTradeItemBody.message, "商品 ID 不合法");

  const invalidTradeActionId = await fetch(`http://127.0.0.1:${port}/api/market/trade-intents/not-a-number`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "cancel" }),
  });
  assert.equal(invalidTradeActionId.status, 400);
  const invalidTradeActionBody = await invalidTradeActionId.json() as any;
  assert.equal(invalidTradeActionBody.code, 4000);
  assert.equal(invalidTradeActionBody.message, "购买意向 ID 不合法");

  const invalidOfferItemId = await fetch(`http://127.0.0.1:${port}/api/market/items/not-a-number/offers`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ price: 88 }),
  });
  assert.equal(invalidOfferItemId.status, 400);
  const invalidOfferItemBody = await invalidOfferItemId.json() as any;
  assert.equal(invalidOfferItemBody.code, 4000);
  assert.equal(invalidOfferItemBody.message, "商品 ID 不合法");

  const invalidOfferActionId = await fetch(`http://127.0.0.1:${port}/api/market/offers/not-a-number`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "reject" }),
  });
  assert.equal(invalidOfferActionId.status, 400);
  const invalidOfferActionBody = await invalidOfferActionId.json() as any;
  assert.equal(invalidOfferActionBody.code, 4000);
  assert.equal(invalidOfferActionBody.message, "购买意向 ID 不合法");

  const invalidOrderActionId = await fetch(`http://127.0.0.1:${port}/api/market/orders/not-a-number`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "cancel", reason: "测试" }),
  });
  assert.equal(invalidOrderActionId.status, 400);
  const invalidOrderActionBody = await invalidOrderActionId.json() as any;
  assert.equal(invalidOrderActionBody.code, 4000);
  assert.equal(invalidOrderActionBody.message, "订单 ID 不合法");

  const invalidConversationItemId = await fetch(`http://127.0.0.1:${port}/api/market/items/not-a-number/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "测试消息" }),
  });
  assert.equal(invalidConversationItemId.status, 400);
  const invalidConversationItemBody = await invalidConversationItemId.json() as any;
  assert.equal(invalidConversationItemBody.code, 4000);
  assert.equal(invalidConversationItemBody.message, "商品 ID 不合法");

  const invalidConversationId = await fetch(`http://127.0.0.1:${port}/api/market/conversations/not-a-number/messages`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(invalidConversationId.status, 400);
  const invalidConversationBody = await invalidConversationId.json() as any;
  assert.equal(invalidConversationBody.code, 4000);
  assert.equal(invalidConversationBody.message, "会话 ID 不合法");

  const invalidMessageReportId = await fetch(`http://127.0.0.1:${port}/api/market/conversations/1/messages/not-a-number/report`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: "测试举报" }),
  });
  assert.equal(invalidMessageReportId.status, 400);
  const invalidMessageReportBody = await invalidMessageReportId.json() as any;
  assert.equal(invalidMessageReportBody.code, 4000);
  assert.equal(invalidMessageReportBody.message, "会话或消息 ID 不合法");

  const invalidReviewOrderId = await fetch(`http://127.0.0.1:${port}/api/market/orders/not-a-number/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ rating: 5, content: "交易顺利" }),
  });
  assert.equal(invalidReviewOrderId.status, 400);
  const invalidReviewOrderBody = await invalidReviewOrderId.json() as any;
  assert.equal(invalidReviewOrderBody.message, "订单 ID 不合法");

  const invalidTrustUserId = await fetch(`http://127.0.0.1:${port}/api/market/users/not-a-number/trust`);
  assert.equal(invalidTrustUserId.status, 400);
  const invalidTrustUserBody = await invalidTrustUserId.json() as any;
  assert.equal(invalidTrustUserBody.message, "用户 ID 不合法");

  const invalidReportItemId = await fetch(`http://127.0.0.1:${port}/api/market/items/not-a-number/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: "测试举报" }),
  });
  assert.equal(invalidReportItemId.status, 400);
  const invalidReportItemBody = await invalidReportItemId.json() as any;
  assert.equal(invalidReportItemBody.message, "商品 ID 不合法");

  const invalidViolationId = await fetch(`http://127.0.0.1:${port}/api/market/admin/violations/not-a-number`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: "revoked", note: "测试" }),
  });
  assert.equal(invalidViolationId.status, 400);
  const invalidViolationBody = await invalidViolationId.json() as any;
  assert.equal(invalidViolationBody.message, "违规记录 ID 不合法");

  const invalidFavoriteItemId = await fetch(`http://127.0.0.1:${port}/api/market/items/not-a-number/favorite`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(invalidFavoriteItemId.status, 400);

  const invalidProfileUserId = await fetch(`http://127.0.0.1:${port}/api/market/users/not-a-number/profile`);
  assert.equal(invalidProfileUserId.status, 400);
});
