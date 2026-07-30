import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORUM_BOARD_DEFS } from "../src/services/defaultBoardCatalog";
import { evaluateMarketContent } from "../src/services/marketTrust";
import { wantedDemandTopicContent } from "../src/services/wantedDemandTopic";

test("current square restores twelve channels while retaining stage 4 linked-discussion support", () => {
  assert.equal(FORUM_BOARD_DEFS.length, 12);
  assert.ok(FORUM_BOARD_DEFS.every((board) => board.anonymousEnabled));
  assert.deepEqual(FORUM_BOARD_DEFS.slice(0, 4).map((board) => ({ slug: board.slug, name: board.name, section: board.section })), [
    { slug: "general", name: "校园广场", section: "general" },
    { slug: "wanted-demand", name: "求购需求", section: "general" },
    { slug: "freshman", name: "新生专区", section: "general" },
    { slug: "question", name: "问答互助", section: "general" },
  ]);
});

test("structured wanted demands render a public forum summary without contact details", () => {
  const content = wantedDemandTopicContent({
    id: 1,
    authorId: 2,
    title: "求显示器",
    category: "digital",
    budgetMinCents: 30000,
    budgetMaxCents: 60000,
    brandModel: "24 英寸",
    condition: "使用良好",
    expectedTradeTime: "本周",
    campus: "SIP",
    location: "中心楼大厅",
    description: "希望支持 HDMI。",
    status: "active",
  });
  assert.match(content, /预算：.*¥300.*¥600/);
  assert.match(content, /SIP.*中心楼大厅/);
  assert.match(content, /联系方式不会公开/);
});

test("stage 4 content rules query the requested scope plus global rules", async () => {
  let capturedWhere: any = null;
  const prisma: any = {
    marketSafetyRule: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        return [{ id: 1, keyword: "教师课件", scope: "learning", category: "copyright", action: "block", note: "禁止上传" }];
      },
    },
  };
  const result = await evaluateMarketContent(prisma, ["未经授权的教师课件"], "learning");
  assert.equal(result.action, "block");
  assert.deepEqual(capturedWhere, { enabled: true, scope: { in: ["learning", "all"] } });
});

test("stage 4 routes and pages expose linked discussions and the four-part learning hub", () => {
  const homeRoute = readFileSync(new URL("../src/routes/home.ts", import.meta.url), "utf8");
  const topicRoute = readFileSync(new URL("../src/routes/topic.ts", import.meta.url), "utf8");
  const marketRoute = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const marketItemWriteService = readFileSync(new URL("../src/services/marketItemWriteService.ts", import.meta.url), "utf8");
  const learningMaterialsRoute = readFileSync(new URL("../src/routes/learningMaterials.ts", import.meta.url), "utf8");
  const searchRoute = readFileSync(new URL("../src/routes/search.ts", import.meta.url), "utf8");
  const post = readFileSync(new URL("../../web/src/views/forum/Post.vue", import.meta.url), "utf8");
  const topic = readFileSync(new URL("../../web/src/views/forum/Topic.vue", import.meta.url), "utf8");
  const hub = readFileSync(new URL("../../web/src/views/learning/Hub.vue", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  assert.match(topicRoute, /linkedMarketItemId/);
  assert.match(topicRoute, /linkedWantedPostId/);
  assert.match(homeRoute, /section:\s*\{ not: null \}/);
  assert.match(topicRoute, /section:\s*\{ not: null \}/);
  assert.match(searchRoute, /section:\s*\{ not: null \}/);
  assert.match(marketItemWriteService, /condition:\s*z\.enum\(ITEM_CONDITIONS\)/);
  assert.doesNotMatch(`${marketRoute}\n${marketItemWriteService}`, /tx\.topic\.create/);
  assert.doesNotMatch(learningMaterialsRoute, /tx\.topic\.create/);
  assert.match(post, /关联市集信息/);
  assert.match(topic, /关联实体商品/);
  assert.match(topic, /关联学习资料/);
  assert.match(topic, /学习资料求购/);
  for (const key of ["goods", "discussion", "materials", "official"]) {
    assert.match(hub, new RegExp(`t\\("learning\\.${key}"\\)`));
  }
  assert.match(router, /path: "learning"[^\n]+views\/learning\/Hub\.vue/);
  assert.match(router, /path: "learning\/materials"[^\n]+LearningMaterials\.vue/);
});

test("structured wanted demands expose anonymous publishing without leaking identity", () => {
  const marketRoute = [
    readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketCatalog.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketWantedCatalog.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/routes/marketWantedWrite.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketCatalogService.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketWantedService.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/services/marketWantedWriteService.ts", import.meta.url), "utf8"),
  ].join("\n");
  const trustService = readFileSync(new URL("../src/services/userTrust.ts", import.meta.url), "utf8");
  const wantedTopic = readFileSync(new URL("../src/services/wantedDemandTopic.ts", import.meta.url), "utf8");
  const wantedPublish = readFileSync(new URL("../../web/src/views/market/WantedPublish.vue", import.meta.url), "utf8");
  const square = readFileSync(new URL("../../web/src/views/forum/Index.vue", import.meta.url), "utf8");
  assert.match(marketRoute, /anonymous:\s*z\.boolean\(\)/);
  assert.doesNotMatch(marketRoute, /consumeAnonymousCredit\(authorId, tx\)/);
  assert.match(trustService, /eligible: true/);
  assert.match(marketRoute, /authorId:\s*isAnonymous\s*\?\s*null/);
  assert.match(wantedTopic, /isAnonymous:\s*Boolean\(wanted\.isAnonymous\)/);
  assert.match(wantedPublish, /Post anonymously[\s\S]*匿名发布求购/);
  assert.match(wantedPublish, /Anonymous publishing is free[\s\S]*匿名发布免费，不消耗积分/);
  assert.match(square, /board-card--wanted/);
  assert.match(square, /#ea580c/);
});

test("stage 4 migration preserves legacy boards while adding scoped rules and official resources", () => {
  const migration = readFileSync(new URL("../prisma/migrations/20260718040000_stage_4_square_learning/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /SET "section" = NULL/);
  assert.doesNotMatch(migration, /DELETE FROM "Board"/);
  assert.match(migration, /"linkedMarketItemId"/);
  assert.match(migration, /"linkedWantedPostId"/);
  assert.match(migration, /"scope" TEXT NOT NULL DEFAULT 'market'/);
  assert.match(migration, /XJTLU_LIBRARY/);
  assert.match(migration, /XJTLU_LM_CORE/);
});

test("market item decoupling migration archives historical auto-topics without deleting content", () => {
  const migration = readFileSync(new URL("../prisma/migrations/20260720030000_decouple_market_items_from_topics/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /"linkedMarketItemId" = COALESCE/);
  assert.match(migration, /SET "topicId" = NULL/);
  assert.match(migration, /"hidden" = TRUE/);
  assert.match(migration, /"locked" = TRUE/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"Topic"/i);
});

test("physical sale form and filters share required category, condition, delivery and sale-price semantics", () => {
  const marketItemWriteService = readFileSync(new URL("../src/services/marketItemWriteService.ts", import.meta.url), "utf8");
  const marketCatalogRoute = readFileSync(new URL("../src/routes/marketCatalog.ts", import.meta.url), "utf8");
  const marketCatalogService = readFileSync(new URL("../src/services/marketCatalogService.ts", import.meta.url), "utf8");
  const itemSchemaStart = marketItemWriteService.indexOf("export const marketItemInputSchema");
  const itemSchema = marketItemWriteService.slice(
    itemSchemaStart,
    marketItemWriteService.indexOf("export const marketItemPatchSchema", itemSchemaStart),
  );
  const publish = readFileSync(new URL("../../web/src/views/market/Publish.vue", import.meta.url), "utf8");
  const publishTemplate = publish.slice(0, publish.indexOf("<script setup"));
  const index = readFileSync(new URL("../../web/src/views/market/Index.vue", import.meta.url), "utf8");
  const marketApi = readFileSync(new URL("../../web/src/api/market.ts", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260721010000_align_market_listing_filters/migration.sql", import.meta.url), "utf8");

  assert.match(itemSchema, /category: z\.string\(\)\.trim\(\)\.regex\(/);
  assert.doesNotMatch(itemSchema, /category:[^\n]+default\("other"\)/);
  for (const requiredField of ["title", "description", "price", "condition"]) {
    assert.match(itemSchema, new RegExp(`${requiredField}:[^\\n]+`));
    assert.doesNotMatch(itemSchema, new RegExp(`${requiredField}:[^\\n]+optional\\(\\)`));
  }
  assert.match(itemSchema, /tradeMode: marketTradeModeSchema,/);
  assert.doesNotMatch(itemSchema, /tradeMode:[^\n]+optional\(\)|tradeMode:[^\n]+default\(/);
  for (const optionalField of ["originalPrice", "negotiable", "campus", "location", "brand", "model", "usageDuration", "flaws", "accessories", "testAllowed", "availableTime"]) {
    assert.match(itemSchema, new RegExp(`${optionalField}:[^\\n]+optional\\(\\)`));
  }
  assert.doesNotMatch(itemSchema, /expiryDays/);
  assert.match(marketCatalogService, /TRADE_MODES = \["meetup", "shipping", "online", "any"\]/);
  assert.match(marketCatalogRoute, /where\.priceCents =/);
  assert.doesNotMatch(marketCatalogRoute, /where\.originalPriceCents/);
  assert.match(marketCatalogRoute, /tradeMode && tradeMode !== "any"/);
  assert.match(marketItemWriteService, /expiresAt: null/);

  assert.match(publish, /:label="isEnglish \? 'Category' : '商品品类'" required/);
  assert.doesNotMatch(publishTemplate, /expiryDays|自动过期/);
  assert.ok(publish.indexOf("v-model=\"form.availableTime\"") > publish.indexOf("Delivery and meetup"));
  assert.match(publish, /:label="isEnglish \? 'Campus \(optional\)' : '校区（选填）'"/);
  assert.match(publish, /v-model="form\.campus" clearable/);
  assert.doesNotMatch(publish, /isMarketCampus\(form\.campus\)|请选择 SIP 或 TC 校区/);
  assert.doesNotMatch(marketItemWriteService, /!input\.draft && !input\.campus|requestedStatus === "active" && !\(input\.campus/);
  assert.match(index, /:placeholder="marketTradeModeLabel\('any'\)"/);
  assert.match(index, /tradeMode: "any"/);
  assert.match(marketApi, /any: "任意交付方式"/);
  assert.match(marketApi, /"meetup" \| "shipping" \| "online" \| "any"/);

  for (const indexedFields of ["status, priceCents", "condition, status, createdAt", "tradeMode, status, createdAt", "campus, status, createdAt"]) {
    assert.match(schema, new RegExp(`@@index\\(\\[${indexedFields}\\]\\)`));
  }
  assert.match(migration, /SET "tradeMode" = 'any'/);
  assert.match(migration, /SET "expiresAt" = NULL/);
});
