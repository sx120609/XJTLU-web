import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  amountCentsToMoney,
  moneyToAmountCents,
  signEpayParams,
  verifyEpayMerchantParams,
  verifyEpayParams,
} from "../src/services/epay";
import { calculateMarketOrderAmounts, marketCommissionBpsForItem } from "../src/services/marketFinance";
import {
  marketPaymentReturnStatus,
  marketPaySchema,
  normalizeMarketPaymentParams,
} from "../src/services/marketPaymentService";
import { marketPaymentRouter } from "../src/routes/marketPayment";
import {
  LEARNING_MATERIAL_MAX_PRICE_CENTS,
  LEARNING_MATERIAL_MIN_PRICE_CENTS,
  PAID_LEARNING_MATERIALS_ENABLED,
  STUDENT_MARKET_PAYMENT_ENABLED,
  directTradeOrderAmounts,
  isAllowedLearningMaterialPrice,
} from "../src/services/marketPolicy";

test("market EasyPay callbacks use deterministic signing and reject tampering", () => {
  const key = "market-test-merchant-key";
  const params: Record<string, string> = {
    pid: "10001",
    out_trade_no: "MKT202607120001",
    trade_no: "EPAY-1001",
    trade_status: "TRADE_SUCCESS",
    type: "alipay",
    money: "12.34",
    param: "market:42",
  };
  params.sign = signEpayParams(params, key);
  params.sign_type = "MD5";
  assert.equal(verifyEpayParams(params, key), true);
  assert.equal(
    verifyEpayMerchantParams(params, {
      pid: "10001",
      merchantKey: key,
    }),
    true,
  );
  assert.equal(
    verifyEpayMerchantParams(params, {
      pid: "other-merchant",
      merchantKey: key,
    }),
    false,
  );
  assert.equal(marketPaymentReturnStatus(params, key), "success");
  assert.equal(verifyEpayParams({ ...params, money: "0.01" }, key), false);
  assert.equal(verifyEpayParams({ ...params, out_trade_no: "OTHER" }, key), false);
  assert.equal(
    marketPaymentReturnStatus({ ...params, trade_status: "WAIT_BUYER_PAY" }, key),
    "pending",
  );
  assert.equal(
    marketPaymentReturnStatus({ ...params, sign: "" }, key),
    "pending",
  );
});

test("market payment input and callback normalization use strict boundaries", () => {
  assert.deepEqual(marketPaySchema.parse({ payType: "alipay" }), {
    payType: "alipay",
  });
  assert.equal(
    marketPaySchema.safeParse({ payType: "cash" }).success,
    false,
  );
  assert.equal(
    marketPaySchema.safeParse({ payType: "alipay", orderId: 1 }).success,
    false,
  );
  assert.deepEqual(normalizeMarketPaymentParams({
    out_trade_no: ["MKT-1", "MKT-2"],
    money: 12.34,
    omitted: undefined,
    empty: null,
  }), {
    out_trade_no: "MKT-1",
    money: "12.34",
  });
});

test("market payment router delegates to the locked service and verifies return signatures", () => {
  const route = readFileSync(
    new URL("../src/routes/marketPayment.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../src/services/marketPaymentService.ts", import.meta.url),
    "utf8",
  );
  const marketRoute = readFileSync(
    new URL("../src/routes/market.ts", import.meta.url),
    "utf8",
  );
  assert.ok(marketPaymentRouter);
  assert.match(route, /positiveRouteInteger\(req\.params\.id\)/);
  assert.match(route, /MarketPaymentNotificationRejected/);
  assert.match(service, /acquireMarketOrderLock\(tx, orderId\)/);
  assert.match(service, /acquireMarketOrderLock\(tx, reference\.id\)/);
  assert.match(service, /acquireMarketItemLock\(tx, order\.itemId\)/);
  assert.match(service, /verifyEpayMerchantParams\(params, credentials\)/);
  assert.match(service, /const origin = getSiteOrigin\(\)/);
  assert.doesNotMatch(service, /x-forwarded-host/i);
  assert.match(
    marketRoute,
    /marketRouter\.use\("\/", marketPaymentRouter\)/,
  );
});

test("market payment amounts round-trip in integer cents", () => {
  assert.equal(moneyToAmountCents("12.34"), 1234);
  assert.equal(moneyToAmountCents(0.01), 1);
  assert.equal(amountCentsToMoney(1234), "12.34");
  assert.throws(() => moneyToAmountCents("0"), /支付金额不正确/);
  assert.throws(() => moneyToAmountCents("not-a-number"), /支付金额不正确/);
  assert.throws(() => moneyToAmountCents("1.001"), /支付金额不正确/);
  assert.throws(() => moneyToAmountCents("1e2"), /支付金额不正确/);
});

test("legacy market finance remains deterministic for historical records", () => {
  assert.deepEqual(calculateMarketOrderAmounts(10_000, 500), {
    amountCents: 10_000,
    commissionBps: 500,
    platformFeeCents: 500,
    sellerAmountCents: 9_500,
  });
  assert.equal(calculateMarketOrderAmounts(1, 500).sellerAmountCents, 1);
  assert.equal(calculateMarketOrderAmounts(10_000, 0).platformFeeCents, 0);
  assert.equal(calculateMarketOrderAmounts(10_000, 90_000).platformFeeCents, 5_000);
});

test("student marketplace uses direct payment with no platform fee", () => {
  assert.equal(STUDENT_MARKET_PAYMENT_ENABLED, false);
  assert.deepEqual(directTradeOrderAmounts(10_000), {
    amountCents: 10_000,
    commissionBps: 0,
    platformFeeCents: 0,
    sellerAmountCents: 10_000,
  });
  assert.equal(marketCommissionBpsForItem({ category: "books", deliveryType: "physical" }, { learningMaterialCommissionBps: 1250 }), 0);
});

test("paid learning materials require a bounded non-zero price", () => {
  assert.equal(PAID_LEARNING_MATERIALS_ENABLED, true);
  assert.equal(isAllowedLearningMaterialPrice(0), false);
  assert.equal(isAllowedLearningMaterialPrice(LEARNING_MATERIAL_MIN_PRICE_CENTS), true);
  assert.equal(isAllowedLearningMaterialPrice(10_000), true);
  assert.equal(isAllowedLearningMaterialPrice(LEARNING_MATERIAL_MAX_PRICE_CENTS + 1), false);
});
