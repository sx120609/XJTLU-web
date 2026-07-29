import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("phase 1 desktop and mobile navigation use the same five current product destinations", () => {
  const layout = source("../../web/src/layouts/MainLayout.vue");
  for (const entry of [
    '{ to: "/home", label: "首页"',
    '{ to: "/market", label: "市集"',
    '{ to: "/square", label: "广场"',
    '{ to: "/services", label: "工具"',
    '{ to: "/profile", label: "我的"',
  ]) {
    assert.match(layout, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(layout, /mobile-tab--publish|PublishActionSheet|label: "发布"/);
  assert.match(layout, /搜索商品 \/ 求购 \/ 帖子 \/ 校园资源/);
});

test("phase 1 keeps direct publishing routes while retiring the unified publish center", () => {
  const routes = source("../../web/src/router/index.ts");
  assert.match(routes, /path: "publish"[^\n]+redirect: "\/home"/);
  assert.match(routes, /path: "publish\/listing"[^\n]+views\/market\/Publish\.vue/);
  assert.match(routes, /path: "publish\/wanted"[^\n]+views\/market\/WantedPublish\.vue/);
  assert.match(routes, /path: "market\/publish"[^\n]+redirect: "\/publish\/listing"/);
  assert.match(routes, /path: "forum"[^\n]+redirect: "\/square"/);

  const wantedPublishForm = source("../../web/src/views/market/WantedPublish.vue");
  assert.match(wantedPublishForm, /marketApi\.createWantedPost/);
});

test("market hero exposes the four requested destinations in product order", () => {
  const market = source("../../web/src/views/market/Index.vue");
  const markers = ["成为商户", "我的交易", "推广服务", "发布商品"];
  let cursor = -1;
  for (const marker of markers) {
    const next = market.indexOf(marker);
    assert.ok(next > cursor, `${marker} should appear after the previous market action`);
    cursor = next;
  }
  assert.match(market, /成为商户<\/el-button>/);
  assert.doesNotMatch(market, />合作商户<\/el-button>/);
});

test("homepage contains exactly the two focused content sections and no campus resources", () => {
  const home = source("../../web/src/views/Home.vue");
  const orderedMarkers = [
    "RECOMMENDED GOODS",
    "SQUARE HOT &amp; WANTED",
  ];
  let cursor = -1;
  for (const marker of orderedMarkers) {
    const next = home.indexOf(marker);
    assert.ok(next > cursor, `${marker} should appear in the planned homepage order`);
    cursor = next;
  }
  assert.match(home, /marketApi\.items\(\{ page: 1, size: 24, listingType: "sell", sort: "popular"/);
  assert.match(home, /slice\(0, 8\)/);
  assert.match(home, /<h2>推荐好物<\/h2>/);
  assert.match(home, /<h2>热议与求购<\/h2>/);
  assert.match(home, /summary\.value\?\.hotTopics/);
  assert.match(home, /title: "我要出售"/);
  assert.match(home, /title: "我要求购"/);
  assert.match(home, /title: "我要发帖"[^\n]+to: "\/post"/);
  assert.equal((home.match(/<section class="home-section/g) || []).length, 2);
  assert.doesNotMatch(home, /marketApi\.wanted|WantedPreviewCard|wantedItems/);
  assert.doesNotMatch(home, /校园资源|CAMPUS RESOURCES|校园公告与动态|OFFICIAL UPDATES|STUDY GOODS|SPONSORED|resourceEntries|announcementEntries/);
  assert.doesNotMatch(home, /const\s+mock|fakeMarket|demoItem/i);
});

test("homepage publish actions are three equal-sized, enlarged and visibly tinted cards", () => {
  const home = source("../../web/src/views/Home.vue");
  assert.match(home, /\.quick-actions\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[^}]*grid-auto-rows:112px[^}]*align-items:stretch/);
  assert.match(home, /\.quick-action\{[^}]*height:112px[^}]*min-height:112px[^}]*max-height:112px[^}]*margin:0[^}]*padding:22px/);
  assert.match(home, /\.quick-action--teal\{[^}]*background:linear-gradient/);
  assert.match(home, /\.quick-action--amber\{[^}]*background:linear-gradient/);
  assert.match(home, /\.quick-action--violet\{[^}]*background:linear-gradient/);
});

test("homepage product previews keep a stable landscape ratio for extreme source images", () => {
  const home = source("../../web/src/views/Home.vue");
  assert.doesNotMatch(home, /const MarketPreviewCard = defineComponent/);
  assert.match(home, /<router-link[\s\S]*?v-for="item in recommendedItems"[\s\S]*?<div class="market-cover">/);
  assert.match(home, /\.market-grid\{[^}]*align-items:start/);
  assert.match(home, /\.market-cover\{[^}]*position:relative[^}]*width:100%[^}]*height:0[^}]*padding-top:68\.9655%[^}]*overflow:hidden/);
  assert.match(home, /\.market-cover img\{[^}]*position:absolute[^}]*inset:0[^}]*width:100%[^}]*height:100%[^}]*object-fit:cover/);
  assert.match(home, /\.market-cover>span\{[^}]*position:absolute[^}]*inset:0[^}]*place-items:center/);
});

test("shared cards do not apply sibling margins inside grids", () => {
  const globalStyles = source("../../web/src/styles/index.scss");
  const promotionCenter = source("../../web/src/views/market/PromotionCenter.vue");
  assert.doesNotMatch(globalStyles, /\.cpu-card\s*\+\s*\.cpu-card\s*\{/);
  assert.match(promotionCenter, /\.plan-grid\{[^}]*align-items:stretch/);
  assert.match(promotionCenter, /\.plan-grid>article\{[^}]*align-self:stretch[^}]*margin:0/);
  assert.match(promotionCenter, /\.order-list\{[^}]*align-items:stretch/);
});

test("market campus controls are SIP and TC selects backed by the API contract", () => {
  const marketRoute = [
    source("../src/routes/market.ts"),
    source("../src/routes/marketCatalog.ts"),
    source("../src/services/marketCatalogService.ts"),
    source("../src/services/marketItemWriteService.ts"),
  ].join("\n");
  const marketApi = source("../../web/src/api/market.ts");
  for (const view of ["Index.vue", "WantedList.vue", "Publish.vue", "WantedPublish.vue"]) {
    const contents = source(`../../web/src/views/market/${view}`);
    assert.match(contents, /<el-select v-model="(?:filters|form)\.campus"/);
    assert.match(contents, /v-for="campus in MARKET_CAMPUSES"/);
    assert.doesNotMatch(contents, /<el-input v-model="(?:filters|form)\.campus"/);
  }
  assert.match(marketApi, /MARKET_CAMPUSES = \["SIP", "TC"\] as const/);
  assert.match(marketApi, /campuses: MarketCampus\[\]/);
  assert.match(marketRoute, /campuses: MARKET_CAMPUSES/);
  assert.match(marketRoute, /校区仅支持 SIP 或 TC/);
});

test("phase 1 global search has a dedicated market result domain", () => {
  const searchRoute = source("../src/routes/search.ts");
  const searchView = source("../../web/src/views/search/Result.vue");
  assert.match(searchRoute, /marketItem\.findMany/);
  assert.match(searchRoute, /marketItems: marketItems\.map/);
  assert.match(searchRoute, /deliveryType: "physical"/);
  assert.match(searchView, /在售商品/);
  assert.match(searchView, /校园求购/);
});

test("phase 1 Flutter shell mirrors the five primary destinations", () => {
  const flutter = source("../../flutter_client/lib/main.dart");
  const paths = ["/home", "/market", "/square", "/services", "/profile"];
  let cursor = -1;
  for (const path of paths) {
    const next = flutter.indexOf(`path: '${path}'`);
    assert.ok(next > cursor, `${path} should appear in Flutter navigation order`);
    cursor = next;
  }
  assert.doesNotMatch(flutter, /label: '发布'|path: '\/publish'/);
});

test("current market keeps product categories but removes the retired section strip", () => {
  const market = source("../../web/src/views/market/Index.vue");
  const wanted = source("../../web/src/views/market/WantedList.vue");
  const learning = source("../../web/src/views/market/LearningMaterials.vue");

  assert.doesNotMatch(market, /MarketSectionNav/);
  assert.doesNotMatch(wanted, /MarketSectionNav/);
  assert.match(market, /class="category-strip"/);
  assert.match(market, /class="materials-feature"/);
  assert.match(market, /靠浦特色学习资料商城/);
  assert.match(market, /审核交付/);

  assert.match(learning, /KAOPU FEATURED LEARNING/);
  assert.match(learning, /<h1>靠浦特色学习资料商城<\/h1>/);
  assert.match(learning, /<div class="price-line">/);
  assert.doesNotMatch(learning, /免费获取/);
});

test("tools hub exposes exactly the three planned entries and preserves campus resources", () => {
  const tools = source("../../web/src/views/services/Index.vue");
  const resources = source("../../web/src/views/services/CampusResources.vue");
  const routes = source("../../web/src/router/index.ts");

  const entries = tools.match(/\{ to: "\/[^"]+", icon: "[^"]+", title: "[^"]+", description: "[^"]+" \}/g) || [];
  assert.equal(entries.length, 3);
  assert.match(tools, /title: "我的教务"/);
  assert.match(tools, /title: "校园工具"/);
  assert.match(tools, /title: "校园资源"/);
  assert.doesNotMatch(tools, /EhallServicesPane|toolsApi|v-for="tool in/);
  assert.match(routes, /path: "services\/resources".*CampusResources\.vue/);
  assert.match(resources, /EhallServicesPane/);
  assert.match(resources, /官方融合门户/);
});
