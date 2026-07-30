import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canTransitionLearningOrder,
  collectionMethodMetadataSchema,
  creatorApplicationInputSchema,
  creatorApplicationReviewSchema,
  IDEMPOTENCY_KEY_PATTERN,
  learningOrderIssueDecisionSchema,
  learningOrderIssueInputSchema,
  materialReviewDecisionSchema,
  paymentEvidenceMetadataSchema,
} from "../src/services/learningCommerceContracts";
import { sweepMarketLifecycle } from "../src/services/marketLifecycle";

test("paid learning order transitions include disputes and keep terminal states closed", () => {
  assert.equal(canTransitionLearningOrder("pending_payment", "awaiting_seller_confirmation"), true);
  assert.equal(canTransitionLearningOrder("awaiting_seller_confirmation", "disputed"), true);
  assert.equal(canTransitionLearningOrder("disputed", "delivered"), true);
  assert.equal(canTransitionLearningOrder("disputed", "pending_payment"), true);
  assert.equal(canTransitionLearningOrder("delivered", "completed"), true);
  assert.equal(canTransitionLearningOrder("delivered", "refunded"), true);
  assert.equal(canTransitionLearningOrder("completed", "refunded"), true);
  assert.equal(canTransitionLearningOrder("refunded", "delivered"), false);
  assert.equal(canTransitionLearningOrder("completed", "delivered"), false);
  assert.equal(canTransitionLearningOrder("expired", "pending_payment"), false);
});

test("creator, review, payment and issue inputs fail closed", () => {
  assert.equal(creatorApplicationInputSchema.safeParse({
    expertise: "CPT",
    experience: "长期整理课程复习资料",
    sampleDescription: "包含章节索引与自测题解析",
    rightsCommitted: true,
  }).success, true);
  assert.equal(creatorApplicationInputSchema.safeParse({
    expertise: "CPT",
    experience: "too short",
    sampleDescription: "sample",
    rightsCommitted: false,
  }).success, false);
  assert.equal(creatorApplicationReviewSchema.safeParse({ action: "reject", reason: "" }).success, false);
  assert.equal(collectionMethodMetadataSchema.safeParse({ provider: "bank", label: "" }).success, false);
  assert.equal(materialReviewDecisionSchema.safeParse({
    action: "approve",
    reason: "",
    checklist: { rights: true, quality: true, fileSafety: false },
  }).success, false);
  assert.equal(paymentEvidenceMetadataSchema.safeParse({
    claimedPaidAt: "2026-07-29T12:00:00.000Z",
    buyerNote: "支付宝尾号 1234",
  }).success, true);
  assert.equal(learningOrderIssueInputSchema.safeParse({
    type: "payment",
    reason: "卖家未确认",
    detail: "已付款并提交真实凭证",
  }).success, true);
  assert.equal(learningOrderIssueInputSchema.safeParse({
    type: "off_platform",
    reason: "异常",
    detail: "异常",
  }).success, false);
  assert.equal(learningOrderIssueDecisionSchema.safeParse({
    action: "record_refund",
    resolution: "已核验线下退款流水",
    refundAmountCents: 990,
    responsibility: "creator",
  }).success, true);
  assert.equal(learningOrderIssueDecisionSchema.safeParse({
    action: "record_refund",
    resolution: "未填写金额",
    responsibility: "creator",
  }).success, false);
  assert.equal(learningOrderIssueDecisionSchema.safeParse({
    action: "resolve",
    resolution: "问题已处理",
    refundAmountCents: 990,
    responsibility: "no_fault",
  }).success, false);
  assert.equal(IDEMPOTENCY_KEY_PATTERN.test("learning-order-12345678"), true);
  assert.equal(IDEMPOTENCY_KEY_PATTERN.test("short"), false);
});

test("seller confirmation timeout enters a locked dispute with an issue and notifications", async () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const writes: Array<{ model: string; data: any }> = [];
  const tx: any = {
    $queryRaw: async () => [{ locked: 1 }],
    learningCommerceOrder: {
      findUnique: async () => ({
        id: 9,
        orderId: 90,
        status: "awaiting_seller_confirmation",
        sellerResponseDueAt: new Date("2026-07-29T11:00:00.000Z"),
        order: { buyerId: 1, sellerId: 2, outTradeNo: "LM90" },
      }),
      updateMany: async ({ data }: any) => {
        writes.push({ model: "learningCommerceOrder", data });
        return { count: 1 };
      },
    },
    marketOrder: {
      update: async ({ data }: any) => {
        writes.push({ model: "marketOrder", data });
        return {};
      },
    },
    learningOrderIssue: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        writes.push({ model: "learningOrderIssue", data });
        return { id: 1 };
      },
    },
    learningOrderEvent: {
      aggregate: async () => ({ _max: { sequence: 3 } }),
      create: async ({ data }: any) => {
        writes.push({ model: "learningOrderEvent", data });
        return {};
      },
    },
    notification: {
      createMany: async ({ data }: any) => {
        writes.push({ model: "notification", data });
        return { count: data.length };
      },
    },
  };
  const prisma: any = {
    marketOrder: { findMany: async () => [] },
    wantedPost: { findMany: async () => [] },
    tradeIntent: { updateMany: async () => ({ count: 0 }) },
    learningCommerceOrder: {
      findMany: async ({ where }: any) => where.status === "awaiting_seller_confirmation"
        ? [{ id: 9, orderId: 90 }]
        : [],
    },
    $transaction: async (operation: any) => operation(tx),
  };
  await sweepMarketLifecycle(prisma, now);
  assert.ok(writes.some((row) => row.model === "learningCommerceOrder" && row.data.status === "disputed"));
  assert.ok(writes.some((row) => row.model === "marketOrder" && row.data.status === "disputed"));
  assert.ok(writes.some((row) => row.model === "learningOrderIssue" && row.data.type === "seller_confirmation_timeout"));
  assert.ok(writes.some((row) => row.model === "notification" && row.data.length === 2));
});

test("delivered learning orders auto-complete only after the no-issue deadline", async () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const writes: Array<{ model: string; data: any }> = [];
  const tx: any = {
    $queryRaw: async () => [{ locked: 1 }],
    learningCommerceOrder: {
      findUnique: async () => ({
        id: 10,
        orderId: 100,
        status: "delivered",
        completionDueAt: new Date("2026-07-29T11:00:00.000Z"),
        order: { buyerId: 1, sellerId: 2 },
        issues: [],
      }),
      updateMany: async ({ data }: any) => {
        writes.push({ model: "learningCommerceOrder", data });
        return { count: 1 };
      },
    },
    marketOrder: {
      update: async ({ data }: any) => {
        writes.push({ model: "marketOrder", data });
        return {};
      },
    },
    transactionPointEntry: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        writes.push({ model: "transactionPointEntry", data });
        return data;
      },
    },
    user: {
      findUnique: async () => ({ transactionPoints: 0 }),
      update: async ({ data }: any) => ({
        transactionPoints: data.transactionPoints.increment,
      }),
    },
    learningOrderEvent: {
      aggregate: async () => ({ _max: { sequence: 4 } }),
      create: async ({ data }: any) => {
        writes.push({ model: "learningOrderEvent", data });
        return {};
      },
    },
  };
  const prisma: any = {
    marketOrder: { findMany: async () => [] },
    wantedPost: { findMany: async () => [] },
    tradeIntent: { updateMany: async () => ({ count: 0 }) },
    learningCommerceOrder: {
      findMany: async ({ where }: any) => where.status === "delivered"
        ? [{ id: 10, orderId: 100 }]
        : [],
    },
    $transaction: async (operation: any) => operation(tx),
  };
  await sweepMarketLifecycle(prisma, now);
  assert.ok(writes.some((row) => row.model === "learningCommerceOrder" && row.data.status === "completed"));
  assert.ok(writes.some((row) => row.model === "marketOrder" && row.data.status === "completed"));
  assert.ok(writes.some((row) => row.model === "learningOrderEvent" && row.data.type === "ORDER_AUTO_COMPLETED"));
  assert.deepEqual(
    writes
      .filter((row) => row.model === "transactionPointEntry")
      .map((row) => row.data.event)
      .sort(),
    ["learning_trade_buyer_completed", "learning_trade_creator_completed"],
  );
});

test("iteration one keeps schema, migration, API and three frontend roles aligned", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../prisma/migrations/20260729010000_learning_commerce_v1/migration.sql", import.meta.url), "utf8");
  const router = readFileSync(new URL("../src/routes/learningCommerce.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/learningCommerceService.ts", import.meta.url), "utf8");
  const webApi = readFileSync(new URL("../../web/src/api/learningMaterials.ts", import.meta.url), "utf8");
  const webRouter = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  const creator = readFileSync(new URL("../../web/src/views/market/LearningCreatorCenter.vue", import.meta.url), "utf8");
  const orders = readFileSync(new URL("../../web/src/views/market/LearningOrders.vue", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../../web/src/views/admin/LearningCommerceAdminPane.vue", import.meta.url), "utf8");

  assert.match(schema, /model LearningCreatorApplication/);
  assert.match(schema, /model LearningCommerceOrder/);
  assert.match(schema, /model LearningPaymentEvidence/);
  assert.match(schema, /disputed/);
  assert.match(schema, /refundedAt/);
  assert.match(migration, /SET "commerceMode" = 'legacy_free'/);
  assert.match(migration, /CREATE UNIQUE INDEX "LearningCollectionMethod_one_active_per_provider"/);
  assert.match(migration, /INSERT INTO "LearningCommerceOrder"/);
  assert.match(migration, /INSERT INTO "MarketConfig"/);
  assert.match(migration, /"learningMaterialCommissionBps" = 0/);
  assert.match(router, /\/creator\/collection-methods/);
  assert.match(router, /\/orders\/:id\/payment-evidence/);
  assert.match(router, /\/admin\/material-reviews/);
  assert.match(router, /\/admin\/orders\/:orderId\/issues\/:issueId/);
  assert.match(service, /platformFeeCents: 0/);
  assert.match(service, /learningMaterialAccess\.upsert/);
  assert.match(service, /publishingAllowed: profile\?\.status === "active"/);
  assert.match(service, /publishingStatus: profile\?\.status \|\| "active"/);
  assert.match(service, /status: "delivered"/);
  assert.match(service, /type: "REFUND_RECORDED"/);
  assert.doesNotMatch(
    service,
    /pg_advisory_xact_lock\([^)]*,[^)]*\)/,
    "PostgreSQL advisory locks must use one bigint key so Prisma does not infer an unsupported bigint,bigint signature",
  );
  assert.match(webApi, /"Idempotency-Key"/);
  assert.match(webRouter, /learning\/materials/);
  assert.match(creator, /学习资料发布中心/);
  assert.match(creator, /myItems/);
  assert.doesNotMatch(creator, /申请成为创作者|提交认证申请/);
  assert.match(orders, /确认到账并交付/);
  assert.match(admin, /资料版本审核/);
});
