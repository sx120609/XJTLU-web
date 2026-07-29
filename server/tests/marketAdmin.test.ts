import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { marketAdminRouter } from "../src/routes/marketAdmin";
import {
  assertMarketRefundTransition,
  assertMarketSettlementTransition,
  marketAdminConfigSchema,
  marketAdminRefundSchema,
  marketAdminSettlementSchema,
  marketAdminWantedSchema,
  marketCategoryCreateSchema,
  marketCategoryPatchSchema,
} from "../src/services/marketAdminService";
import {
  marketCategoryLockKey,
} from "../src/services/marketCategoryLockService";

test("market admin schemas keep financial and category writes narrow", () => {
  assert.deepEqual(
    marketAdminConfigSchema.parse({ learningMaterialCommissionRate: 0 }),
    { learningMaterialCommissionRate: 0 },
  );
  assert.equal(
    marketAdminConfigSchema.safeParse({
      learningMaterialCommissionRate: 0,
      commissionRate: 5,
    }).success,
    false,
  );
  assert.equal(
    marketCategoryCreateSchema.safeParse({
      slug: "digital_again",
      name: "Digital",
      fulfillmentType: "digital",
    }).success,
    false,
  );
  assert.equal(
    marketCategoryPatchSchema.safeParse({
      enabled: false,
      slug: "renamed",
    }).success,
    false,
  );
  assert.equal(
    marketAdminWantedSchema.safeParse({
      status: "completed",
    }).success,
    false,
  );
  assert.equal(
    marketAdminRefundSchema.safeParse({
      status: "completed",
      amountCents: 1,
    }).success,
    false,
  );
  assert.equal(
    marketAdminSettlementSchema.safeParse({
      status: "settled",
      sellerId: 1,
    }).success,
    false,
  );
});

test("market admin refund and settlement state machines reject terminal rewrites", () => {
  assert.doesNotThrow(() => {
    assertMarketRefundTransition("pending", "approved");
    assertMarketRefundTransition("approved", "completed");
    assertMarketRefundTransition("failed", "approved");
    assertMarketSettlementTransition("pending", "available");
    assertMarketSettlementTransition("available", "held");
    assertMarketSettlementTransition("held", "settled");
  });
  assert.throws(
    () => assertMarketRefundTransition("completed", "approved"),
    /退款状态不能/,
  );
  assert.throws(
    () => assertMarketRefundTransition("pending", "completed"),
    /退款状态不能/,
  );
  assert.throws(
    () => assertMarketSettlementTransition("settled", "held"),
    /结算状态不能/,
  );
  assert.throws(
    () => assertMarketSettlementTransition("pending", "settled"),
    /结算状态不能/,
  );
});

test("market category locks are deterministic and isolated by slug", () => {
  assert.equal(
    marketCategoryLockKey(" Books "),
    marketCategoryLockKey("books"),
  );
  assert.notEqual(
    marketCategoryLockKey("books"),
    marketCategoryLockKey("electronics"),
  );
});

test("market admin router delegates locks, cleanup, audit and safe serialization", () => {
  const route = readFileSync(
    new URL("../src/routes/marketAdmin.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../src/services/marketAdminService.ts", import.meta.url),
    "utf8",
  );
  const itemService = readFileSync(
    new URL("../src/services/marketItemWriteService.ts", import.meta.url),
    "utf8",
  );
  const wantedService = readFileSync(
    new URL("../src/services/marketWantedService.ts", import.meta.url),
    "utf8",
  );
  const marketRoute = readFileSync(
    new URL("../src/routes/market.ts", import.meta.url),
    "utf8",
  );
  assert.ok(marketAdminRouter);
  assert.match(route, /positiveRouteInteger\(value\)/);
  assert.match(service, /acquireMarketCategoryLock\(tx, reference\.slug\)/);
  assert.match(service, /acquireMarketOrderLock\(tx, reference\.orderId\)/);
  assert.match(service, /acquireMarketWantedLock\(tx, wantedPostId\)/);
  assert.match(service, /logMarketAdminAction\(tx/);
  assert.match(service, /serializeMarketOrder\(order\)/);
  assert.match(service, /openMarketSensitive\(profile\.accountEncrypted\)/);
  assert.match(itemService, /acquireMarketCategoryLock\(tx, input\.category\)/);
  assert.match(wantedService, /closePendingWantedInterest/);
  assert.match(wantedService, /tx\.tradeIntent\.updateMany/);
  assert.match(wantedService, /tx\.marketOffer\.updateMany/);
  assert.match(marketRoute, /marketRouter\.use\("\/", marketAdminRouter\)/);
  assert.doesNotMatch(marketRoute, /marketRouter\.(get|post|patch|delete|all)\(/);
});
