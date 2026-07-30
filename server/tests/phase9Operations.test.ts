import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { serializePromotionOrder } from "../src/services/promotion";

test("phase 9 promotion receipts hide raw references from public responses", () => {
  const order = {
    amountCents: 1280,
    verifiedAmountCents: 1280,
    verificationMethod: "alipay",
    verificationReference: "20260719001234567890",
    type: "listing_pin",
    impressionCount: 100,
    clickCount: 8,
  };
  const publicOrder = serializePromotionOrder(order);
  assert.equal(publicOrder.verificationReference, undefined);
  assert.equal(publicOrder.verificationReferenceMasked.endsWith("7890"), true);
  assert.equal(publicOrder.verifiedAmount, "12.80");
  const privateOrder = serializePromotionOrder(order, true);
  assert.equal(privateOrder.verificationReference, order.verificationReference);
});

test("V1 exposes four current operational funnels and manual revenue verification UI", () => {
  const service = readFileSync(new URL("../src/services/marketOperations.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../src/routes/marketPromotions.ts", import.meta.url), "utf8");
  const operations = readFileSync(new URL("../../web/src/views/admin/OperationsPane.vue", import.meta.url), "utf8");
  const promotion = readFileSync(new URL("../../web/src/views/admin/PromotionPane.vue", import.meta.url), "utf8");
  for (const key of ["trade", "wanted", "learning", "promotion"]) assert.match(service, new RegExp(`key: "${key}"`));
  assert.doesNotMatch(service, /key: "merchant"/);
  assert.match(routes, /\/admin\/operations/);
  assert.match(routes, /PROMOTION_VERIFIED_AMOUNT_MISMATCH/);
  assert.match(operations, /盈利订单始终由管理员逐单人工核验/);
  assert.match(promotion, /核验凭证号 \/ 流水号/);
  assert.match(promotion, /实收金额必须与订单快照金额一致/);
});
