import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isMarketCampus,
  MARKET_CAMPUSES,
  marketCampusStorageAliases,
  normalizeMarketCampus,
} from "../src/services/marketCampus";
import { MARKET_PUBLIC_USER_SELECT } from "../src/services/marketPublicUser";

test("market campus values are canonical while legacy client aliases stay compatible", () => {
  assert.deepEqual(MARKET_CAMPUSES, ["SIP", "TC"]);
  assert.equal(normalizeMarketCampus("sip"), "SIP");
  assert.equal(normalizeMarketCampus("苏州校区"), "SIP");
  assert.equal(normalizeMarketCampus("太仓"), "TC");
  assert.equal(normalizeMarketCampus("Taicang"), "TC");
  assert.equal(normalizeMarketCampus("TC 校区"), "TC");
  assert.equal(normalizeMarketCampus("未知校区"), "未知校区");
  assert.equal(isMarketCampus(normalizeMarketCampus("太仓")), true);
  assert.ok(marketCampusStorageAliases("SIP").includes("苏州"));
  assert.ok(marketCampusStorageAliases("TC").includes("太仓"));
});

test("v1 routes products and learning materials to manual review without product AI", () => {
  const itemWriteService = readFileSync(
    new URL("../src/services/marketItemWriteService.ts", import.meta.url),
    "utf8",
  );
  const learningRoute = readFileSync(
    new URL("../src/routes/learningMaterials.ts", import.meta.url),
    "utf8",
  );
  const learningCommerce = readFileSync(
    new URL("../src/services/learningCommerceService.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(itemWriteService, /reviewTopicContent|shouldRunAiReview|shouldBypassAiReviewForUser/);
  assert.match(itemWriteService, /status: input\.draft \? "draft" : "reviewing"/);
  assert.match(itemWriteService, /sellerNeedsManualReview/);
  assert.match(itemWriteService, /!isMarketItemStaff\(actor\.role\) \? "reviewing" : "active"/);
  assert.doesNotMatch(learningRoute, /reviewTopicContent|shouldRunAiReview|shouldBypassAiReviewForUser/);
  assert.match(learningCommerce, /data: \{ status: "reviewing", moderationNote:/);
});

test("market public user objects never expose the XJTLU login name", () => {
  assert.equal("username" in MARKET_PUBLIC_USER_SELECT, false);
  assert.deepEqual(
    Object.keys(MARKET_PUBLIC_USER_SELECT),
    ["id", "nickname", "avatar", "major", "role", "studentSso", "createdAt"],
  );
});

test("global search uses the shared optional authentication middleware", () => {
  const source = readFileSync(
    new URL("../src/routes/search.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /searchRouter\.use\(authOptional\)/);
  assert.match(source, /req\.user\?\.userId/);
  assert.doesNotMatch(source, /verifyToken/);
});

test("legacy material and campus entry pages redirect to supported destinations", () => {
  const routerSource = readFileSync(
    new URL("../../web/src/router/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    routerSource,
    /path: "learning\/materials"[^\n]+LearningMaterials\.vue/,
  );
  assert.match(
    routerSource,
    /path: "market\/learning-materials"[^\n]+redirect: "\/learning\/materials"/,
  );
  assert.match(routerSource, /path: "learning\/free"[^\n]+redirect: "\/learning\/materials"/);
  assert.match(routerSource, /path: "jwxt"[\s\S]*?redirect: "\/academic"/);
  assert.match(
    routerSource,
    /path: "schedule"[\s\S]*?redirect: "\/academic"/,
  );
});

test("native shells use supported campus and primary product entry points", () => {
  const androidSource = readFileSync(
    new URL("../../android/app/build.gradle", import.meta.url),
    "utf8",
  );
  const harmonySource = readFileSync(
    new URL(
      "../../harmony/entry/src/main/ets/common/AppConfig.ets",
      import.meta.url,
    ),
    "utf8",
  );
  const flutterSource = readFileSync(
    new URL("../../flutter_client/lib/main.dart", import.meta.url),
    "utf8",
  );
  assert.match(
    androidSource,
    /defaultAppUrl = "https:\/\/cpu\.lizmt\.cn\/academic"/,
  );
  assert.match(
    harmonySource,
    /https:\/\/cpu\.lizmt\.cn\/academic\?client=harmony-app/,
  );
  assert.match(flutterSource, /path: '\/home'/);
  assert.match(flutterSource, /path: '\/market'/);
  assert.match(flutterSource, /path: '\/square'/);
  assert.match(flutterSource, /path: '\/services'/);
  assert.match(flutterSource, /path: '\/profile'/);
  assert.doesNotMatch(flutterSource, /label: '发布'|path: '\/publish'/);
});

test("market services enforce direct trade and block digital category mutation", () => {
  const tradeService = readFileSync(
    new URL("../src/services/marketTradeService.ts", import.meta.url),
    "utf8",
  );
  const paymentService = readFileSync(
    new URL("../src/services/marketPaymentService.ts", import.meta.url),
    "utf8",
  );
  const adminService = readFileSync(
    new URL("../src/services/marketAdminService.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    tradeService,
    /const orderAmounts = directTradeOrderAmounts\(offer\.priceCents\)/,
  );
  assert.match(
    paymentService,
    /if \(!STUDENT_MARKET_PAYMENT_ENABLED\)/,
  );
  assert.match(paymentService, /MARKET_PAYMENT_DISABLED_MESSAGE/);
  assert.match(
    adminService,
    /fulfillmentType: z\.literal\("physical"\)/,
  );
  assert.match(
    adminService,
    /历史数字品类已冻结，不能修改或重新启用/,
  );
});
