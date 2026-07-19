import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isMarketCampus, MARKET_CAMPUSES, marketCampusStorageAliases, normalizeMarketCampus } from "../src/services/marketCampus";
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

test("market public user objects never expose the XJTLU login name", () => {
  assert.equal("username" in MARKET_PUBLIC_USER_SELECT, false);
  assert.deepEqual(Object.keys(MARKET_PUBLIC_USER_SELECT), ["id", "nickname", "avatar", "role", "studentSso", "createdAt"]);
});

test("global search uses the shared optional authentication middleware", () => {
  const source = readFileSync(new URL("../src/routes/search.ts", import.meta.url), "utf8");
  assert.match(source, /searchRouter\.use\(authOptional\)/);
  assert.match(source, /req\.user\?\.userId/);
  assert.doesNotMatch(source, /verifyToken/);
});

test("legacy material and campus entry pages redirect to supported destinations", () => {
  const routerSource = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  assert.match(routerSource, /path: "learning\/free"[^\n]+LearningMaterials\.vue/);
  assert.match(routerSource, /path: "market\/learning-materials"[^\n]+redirect: "\/learning\/free"/);
  assert.match(routerSource, /path: "jwxt"[\s\S]*?redirect: "\/academic"/);
  assert.match(routerSource, /path: "schedule"[\s\S]*?redirect: "\/academic"/);
});

test("native shells use supported campus and primary product entry points", () => {
  const androidSource = readFileSync(new URL("../../android/app/build.gradle", import.meta.url), "utf8");
  const harmonySource = readFileSync(new URL("../../harmony/entry/src/main/ets/common/AppConfig.ets", import.meta.url), "utf8");
  const flutterSource = readFileSync(new URL("../../flutter_client/lib/main.dart", import.meta.url), "utf8");
  assert.match(androidSource, /defaultAppUrl = "https:\/\/cpu\.lizmt\.cn\/academic"/);
  assert.match(harmonySource, /https:\/\/cpu\.lizmt\.cn\/academic\?client=harmony-app/);
  assert.match(flutterSource, /path: '\/home'/);
  assert.match(flutterSource, /path: '\/market'/);
  assert.match(flutterSource, /path: '\/square'/);
  assert.match(flutterSource, /path: '\/services'/);
  assert.match(flutterSource, /path: '\/profile'/);
  assert.doesNotMatch(flutterSource, /label: '发布'|path: '\/publish'/);
});

test("market route enforces direct trade and blocks digital category mutation", () => {
  const source = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  assert.match(source, /const orderAmounts = directTradeOrderAmounts\(offer\.priceCents\)/);
  assert.match(source, /if \(!STUDENT_MARKET_PAYMENT_ENABLED\) throw Errors\.forbidden\(MARKET_PAYMENT_DISABLED_MESSAGE\)/);
  assert.match(source, /fulfillmentType: z\.literal\("physical"\)/);
  assert.match(source, /历史数字品类已冻结，不能修改或重新启用/);
});
