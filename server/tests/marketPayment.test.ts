import test from "node:test";
import assert from "node:assert/strict";
import { amountCentsToMoney, moneyToAmountCents, signEpayParams, verifyEpayParams } from "../src/services/epay";
import { calculateMarketOrderAmounts, marketCommissionBpsForItem } from "../src/services/marketFinance";
import {
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
  assert.equal(verifyEpayParams({ ...params, money: "0.01" }, key), false);
  assert.equal(verifyEpayParams({ ...params, out_trade_no: "OTHER" }, key), false);
});

test("market payment amounts round-trip in integer cents", () => {
  assert.equal(moneyToAmountCents("12.34"), 1234);
  assert.equal(moneyToAmountCents(0.01), 1);
  assert.equal(amountCentsToMoney(1234), "12.34");
  assert.throws(() => moneyToAmountCents("0"), /支付金额不正确/);
  assert.throws(() => moneyToAmountCents("not-a-number"), /支付金额不正确/);
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

test("paid learning materials remain disabled while free content is allowed", () => {
  assert.equal(PAID_LEARNING_MATERIALS_ENABLED, false);
  assert.equal(isAllowedLearningMaterialPrice(0), true);
  assert.equal(isAllowedLearningMaterialPrice(1), false);
  assert.equal(isAllowedLearningMaterialPrice(10_000), false);
});
