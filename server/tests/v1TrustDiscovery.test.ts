import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  boundedSignal,
  scoreLearningMaterial,
  scorePhysicalItem,
  scoreTopic,
  scoreWantedPost,
  timeDecay,
} from "../src/services/v1DiscoveryService";
import { transactionPointLevel, violationPointPenalty } from "../src/services/transactionPoints";
import { shanghaiDateKey } from "../src/services/v1ProductAnalytics";
import { decodeTopicForViewer } from "../src/services/forumPresentation";

test("V1 transaction points have stable levels and proportional governance penalties", () => {
  assert.equal(transactionPointLevel(0).label, "校园新伙伴");
  assert.equal(transactionPointLevel(49).nextLevelAt, 50);
  assert.equal(transactionPointLevel(50).label, "交易参与者");
  assert.equal(transactionPointLevel(150).label, "可信贡献者");
  assert.equal(transactionPointLevel(350).label, "校园协作者");
  assert.equal(transactionPointLevel(700).label, "靠浦先锋");
  assert.equal(transactionPointLevel(-100).points, 0);
  assert.equal(violationPointPenalty("low"), -10);
  assert.equal(violationPointPenalty("medium"), -25);
  assert.equal(violationPointPenalty("critical"), -50);
});

test("V1 hot ranking decays with time, caps raw traffic and lets trust signals outweigh views", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  assert.ok(Math.abs(timeDecay(new Date(now.getTime() - 21 * 86_400_000), 21, now) - 0.5) < 0.0001);
  assert.equal(boundedSignal(1_000_000_000, 1, 4), 4);

  const trafficOnly = scorePhysicalItem({
    createdAt: now,
    views: 100_000,
    favorites: 0,
    offers: 0,
    contacts: 0,
    completed: 0,
    reports: 0,
    sellerPoints: 0,
  }, now);
  const trustedTrade = scorePhysicalItem({
    createdAt: now,
    views: 20,
    favorites: 5,
    offers: 3,
    contacts: 3,
    completed: 4,
    reports: 0,
    sellerPoints: 350,
  }, now);
  const governed = scorePhysicalItem({
    createdAt: now,
    views: 100_000,
    favorites: 100,
    offers: 100,
    contacts: 100,
    completed: 4,
    reports: 8,
    sellerPoints: 700,
  }, now);
  assert.ok(trustedTrade.score > trafficOnly.score);
  assert.ok(governed.score < trustedTrade.score);
  assert.ok(trustedTrade.reasons.includes("近期成交活跃"));
});

test("V1 learning, wanted and topic ranks explain quality and resist governance risk", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const learning = scoreLearningMaterial({
    createdAt: now,
    views: 100,
    favorites: 8,
    completed: 10,
    ratingCount: 8,
    averageRating: 4.8,
    issueCount: 0,
    refundCount: 0,
    creatorQuality: 90,
    reports: 0,
  }, now);
  const riskyLearning = scoreLearningMaterial({
    createdAt: now,
    views: 1_000,
    favorites: 30,
    completed: 10,
    ratingCount: 8,
    averageRating: 4.8,
    issueCount: 5,
    refundCount: 3,
    creatorQuality: 40,
    reports: 4,
  }, now);
  assert.ok(learning.score > riskyLearning.score);
  assert.ok(learning.reasons.includes("真实成交较多"));

  const urgentWanted = scoreWantedPost({
    createdAt: now,
    views: 10,
    validResponses: 2,
    completed: 0,
    urgent: true,
    reports: 0,
    authorPoints: 50,
  }, now);
  const reportedWanted = scoreWantedPost({
    createdAt: now,
    views: 1_000,
    validResponses: 2,
    completed: 0,
    urgent: true,
    reports: 4,
    authorPoints: 700,
  }, now);
  assert.ok(urgentWanted.score > reportedWanted.score);

  const healthyTopic = scoreTopic({
    createdAt: now,
    views: 100,
    likes: 10,
    replies: 8,
    pinned: false,
    riskScore: 0,
    authorPoints: 50,
  }, now);
  const riskyTopic = scoreTopic({
    createdAt: now,
    views: 1_000,
    likes: 10,
    replies: 8,
    pinned: false,
    riskScore: 95,
    authorPoints: 700,
  }, now);
  assert.ok(healthyTopic.score > riskyTopic.score);
});

test("V1 daily analytics uses Asia/Shanghai calendar boundaries", () => {
  assert.equal(shanghaiDateKey(new Date("2026-07-28T15:59:59.000Z")), "2026-07-28");
  assert.equal(shanghaiDateKey(new Date("2026-07-28T16:00:00.000Z")), "2026-07-29");
});

test("V1 topic activity and material version updates refresh decay without trusting invalid dates", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const oldCreatedAt = new Date("2026-01-01T12:00:00.000Z");
  const recentActivityAt = new Date("2026-07-29T10:00:00.000Z");
  assert.equal(timeDecay("not-a-date", 14, now), 0);

  const staleTopic = scoreTopic({
    createdAt: oldCreatedAt,
    views: 100,
    likes: 10,
    replies: 8,
    pinned: false,
    riskScore: 0,
    authorPoints: 50,
  }, now);
  const activeTopic = scoreTopic({
    createdAt: oldCreatedAt,
    lastReplyAt: recentActivityAt,
    views: 100,
    likes: 10,
    replies: 8,
    pinned: false,
    riskScore: 0,
    authorPoints: 50,
  }, now);
  assert.ok(activeTopic.score > staleTopic.score);

  const refreshedMaterial = scoreLearningMaterial({
    createdAt: oldCreatedAt,
    contentUpdatedAt: recentActivityAt,
    views: 20,
    favorites: 2,
    completed: 2,
    ratingCount: 2,
    averageRating: 4.5,
    issueCount: 0,
    refundCount: 0,
    creatorQuality: 80,
    reports: 0,
  }, now);
  assert.ok(refreshedMaterial.score > 0);
});

test("V1 topic responses expose ranking reasons without leaking internal hot signals", () => {
  const decoded = decodeTopicForViewer({
    id: 1,
    authorId: 2,
    metadata: "{}",
    hotScore: 42,
    hotScoreUpdatedAt: new Date(),
    hotSignals: JSON.stringify({
      reasons: ["讨论参与较多", "同学点赞较多"],
      signals: { riskScore: 88 },
    }),
    isAnonymous: false,
    tags: [],
    author: { id: 2, nickname: "校园同学", role: "user" },
  });
  assert.deepEqual(decoded.hotReasons, ["讨论参与较多", "同学点赞较多"]);
  assert.equal("hotSignals" in decoded, false);
});

test("V1 contracts keep forum reputation separate and wire full-stack release controls", async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const [
    schema,
    migration,
    pointService,
    discovery,
    lifecycle,
    fulfillment,
    governance,
    trust,
    home,
    forumPresentation,
    analyticsRoute,
    router,
    mine,
    operations,
    workflow,
  ] = await Promise.all([
    readFile(path.join(root, "server/prisma/schema.prisma"), "utf8"),
    readFile(path.join(root, "server/prisma/migrations/20260729030000_v1_trust_discovery/migration.sql"), "utf8"),
    readFile(path.join(root, "server/src/services/transactionPoints.ts"), "utf8"),
    readFile(path.join(root, "server/src/services/v1DiscoveryService.ts"), "utf8"),
    readFile(path.join(root, "server/src/services/marketLifecycle.ts"), "utf8"),
    readFile(path.join(root, "server/src/services/marketOrderFulfillmentService.ts"), "utf8"),
    readFile(path.join(root, "server/src/services/marketGovernanceService.ts"), "utf8"),
    readFile(path.join(root, "server/src/services/marketTrust.ts"), "utf8"),
    readFile(path.join(root, "server/src/routes/home.ts"), "utf8"),
    readFile(path.join(root, "server/src/services/forumPresentation.ts"), "utf8"),
    readFile(path.join(root, "server/src/routes/productAnalytics.ts"), "utf8"),
    readFile(path.join(root, "web/src/router/index.ts"), "utf8"),
    readFile(path.join(root, "web/src/views/market/Mine.vue"), "utf8"),
    readFile(path.join(root, "web/src/views/admin/OperationsPane.vue"), "utf8"),
    readFile(path.join(root, "docs/iteration-3-v1-release-workflow.md"), "utf8"),
  ]);
  assert.match(schema, /reputation\s+Int\s+@default\(0\)/);
  assert.match(schema, /transactionPoints\s+Int\s+@default\(0\)/);
  assert.match(schema, /model TransactionPointEntry/);
  assert.match(schema, /model ProductActivityDaily/);
  assert.match(migration, /论坛 reputation 不迁移、不复用/);
  assert.match(migration, /TransactionPointEntry_userId_event_sourceType_sourceId_key/);
  assert.match(migration, /historical_penalties/);
  assert.match(migration, /LEAST\(current_points/);
  assert.match(migration, /mo\."deliveryType" = 'physical'/);
  assert.match(pointService, /pg_advisory_xact_lock/);
  assert.match(pointService, /Math\.min\(user\.transactionPoints/);
  assert.match(discovery, /timeDecay/);
  assert.match(discovery, /governancePenalty/);
  assert.match(discovery, /lastReplyAt: \{ gte: activeTopicCutoff \}/);
  assert.match(discovery, /expiredFromHotRanking/);
  assert.match(lifecycle, /learning_trade_buyer_completed/);
  assert.match(lifecycle, /learning_trade_creator_completed/);
  assert.match(fulfillment, /if \(order\.deliveryType === "physical"\)/);
  assert.match(fulfillment, /accepted_order_cancelled/);
  assert.match(governance, /order\.deliveryType !== "physical"/);
  assert.match(trust, /learningCommerceOrder: \{ is: null \}/);
  assert.match(home, /topic\.hotScoreUpdatedAt/);
  assert.match(home, /ensureV1HotRankingFresh/);
  assert.match(forumPresentation, /const \{ hotSignals, \.\.\.publicTopic \} = topic/);
  assert.match(forumPresentation, /hotReasons/);
  assert.match(analyticsRoute, /z\.enum\(V1_PRODUCT_SURFACES\)/);
  assert.match(router, /productAnalyticsApi\.record/);
  assert.match(router, /name === "services"/);
  assert.match(mine, /交易积分/);
  assert.match(operations, /V1 产品健康度/);
  assert.match(workflow, /上线准备度/);
});
