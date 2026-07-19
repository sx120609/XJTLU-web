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
  const topicRoute = readFileSync(new URL("../src/routes/topic.ts", import.meta.url), "utf8");
  const post = readFileSync(new URL("../../web/src/views/forum/Post.vue", import.meta.url), "utf8");
  const topic = readFileSync(new URL("../../web/src/views/forum/Topic.vue", import.meta.url), "utf8");
  const hub = readFileSync(new URL("../../web/src/views/learning/Hub.vue", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  assert.match(topicRoute, /linkedMarketItemId/);
  assert.match(topicRoute, /linkedWantedPostId/);
  assert.match(post, /关联市集信息/);
  assert.match(topic, /关联商品/);
  for (const title of ["学习好物", "学习交流", "免费原创", "官方学习资源"]) assert.match(hub, new RegExp(title));
  assert.match(router, /path: "learning"[^\n]+views\/learning\/Hub\.vue/);
  assert.match(router, /path: "learning\/free"[^\n]+LearningMaterials\.vue/);
});

test("structured wanted demands expose anonymous publishing without leaking identity", () => {
  const marketRoute = readFileSync(new URL("../src/routes/market.ts", import.meta.url), "utf8");
  const wantedTopic = readFileSync(new URL("../src/services/wantedDemandTopic.ts", import.meta.url), "utf8");
  const wantedPublish = readFileSync(new URL("../../web/src/views/market/WantedPublish.vue", import.meta.url), "utf8");
  const square = readFileSync(new URL("../../web/src/views/forum/Index.vue", import.meta.url), "utf8");
  assert.match(marketRoute, /anonymous:\s*z\.boolean\(\)/);
  assert.match(marketRoute, /consumeAnonymousCredit\(authorId, tx\)/);
  assert.match(marketRoute, /authorId:\s*isAnonymous\s*\?\s*null/);
  assert.match(wantedTopic, /isAnonymous:\s*Boolean\(wanted\.isAnonymous\)/);
  assert.match(wantedPublish, /匿名发布求购/);
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
