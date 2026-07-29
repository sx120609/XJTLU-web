import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminPaymentRouter } from "../src/routes/admin/payments";
import {
  adminEpayConfigPatchSchema,
  adminEpayPreviewSchema,
  adminSponsorConfigPatchSchema,
  adminSponsorOrderPatchSchema,
} from "../src/services/adminPaymentService";
import {
  moneyToAmountCents,
  signEpayParams,
  verifyEpayMerchantParams,
} from "../src/services/epay";
import {
  normalizeSponsorPaymentParams,
  sponsorCreateSchema,
  sponsorOrderListQuerySchema,
} from "../src/services/sponsorPaymentService";

test("payment schemas reject ambiguous secrets, amounts, and admin transitions", () => {
  assert.equal(adminEpayConfigPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminEpayConfigPatchSchema.safeParse({
      merchantKey: "new-secret",
      clearMerchantKey: true,
    }).success,
    false,
  );
  assert.equal(
    adminEpayConfigPatchSchema.safeParse({
      enabledTypes: ["alipay"],
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    adminEpayPreviewSchema.safeParse({
      outTradeNo: "TEST-1",
      name: "测试",
      money: "0.001",
    }).success,
    false,
  );
  assert.equal(
    adminSponsorConfigPatchSchema.safeParse({
      presetAmounts: ["5.00", "10.001"],
    }).success,
    false,
  );
  assert.equal(adminSponsorOrderPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminSponsorOrderPatchSchema.safeParse({ status: "pending" }).success,
    false,
  );
  assert.equal(
    adminSponsorOrderPatchSchema.safeParse({ status: "paid" }).success,
    false,
  );
  assert.equal(
    adminSponsorOrderPatchSchema.safeParse({
      status: "paid",
      adminNote: "已核对网关流水",
    }).success,
    true,
  );
});

test("public sponsorship input and callback normalization stay strict", () => {
  assert.equal(
    sponsorCreateSchema.safeParse({
      amount: "10.00",
      payType: "alipay",
      displayMode: "public",
    }).success,
    true,
  );
  assert.equal(
    sponsorCreateSchema.safeParse({
      amount: "10.00",
      payType: "alipay",
      userId: 1,
    }).success,
    false,
  );
  assert.equal(
    sponsorOrderListQuerySchema.safeParse({
      status: "unknown",
    }).success,
    false,
  );
  assert.deepEqual(
    normalizeSponsorPaymentParams({
      pid: ["10001", "attacker"],
      money: 12.34,
      omitted: undefined,
    }),
    {
      pid: "10001",
      money: "12.34",
    },
  );
});

test("merchant verification binds a valid signature to the configured PID", () => {
  const merchantKey = "payment-test-secret";
  const params: Record<string, string> = {
    pid: "10001",
    out_trade_no: "SP-TEST-1",
    trade_status: "TRADE_SUCCESS",
    money: "12.34",
  };
  params.sign = signEpayParams(params, merchantKey);
  params.sign_type = "MD5";
  assert.equal(
    verifyEpayMerchantParams(params, {
      pid: "10001",
      merchantKey,
    }),
    true,
  );
  assert.equal(
    verifyEpayMerchantParams(params, {
      pid: "20002",
      merchantKey,
    }),
    false,
  );
  assert.equal(moneyToAmountCents("12.34"), 1234);
  assert.throws(() => moneyToAmountCents("12.345"), /支付金额不正确/);
  assert.throws(() => moneyToAmountCents("1e2"), /支付金额不正确/);
});

test("payment routes delegate to locked services without trusting request hosts", () => {
  const adminRoute = readFileSync(
    new URL("../src/routes/admin/payments.ts", import.meta.url),
    "utf8",
  );
  const adminService = readFileSync(
    new URL("../src/services/adminPaymentService.ts", import.meta.url),
    "utf8",
  );
  const publicRoute = readFileSync(
    new URL("../src/routes/payments.ts", import.meta.url),
    "utf8",
  );
  const sponsorService = readFileSync(
    new URL("../src/services/sponsorPaymentService.ts", import.meta.url),
    "utf8",
  );
  const epayService = readFileSync(
    new URL("../src/services/epay.ts", import.meta.url),
    "utf8",
  );
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminPaymentRouter);
  assert.match(adminRoute, /adminPaymentRouter\.use\(adminOnly\)/);
  assert.match(
    adminIndex,
    /adminRouter\.use\("\/", adminPaymentRouter\)/,
  );
  assert.doesNotMatch(
    adminIndex,
    /adminRouter\.(get|post|patch)\(\s*"\/(?:epay-config|sponsor-)/,
  );
  assert.match(adminService, /acquireSponsorOrderLock\(tx, orderId\)/);
  assert.match(adminService, /sponsor\.order\.update/);
  assert.match(sponsorService, /acquireEpayConfigLock\(tx\)/);
  assert.match(
    sponsorService,
    /acquireSponsorOrderLock\(tx, reference\.id\)/,
  );
  assert.match(
    sponsorService,
    /verifyEpayMerchantParams\(params, credentials\)/,
  );
  assert.match(sponsorService, /sponsorPaymentReturnTarget/);
  assert.doesNotMatch(publicRoute, /x-forwarded-host|headers\.host/i);
  assert.match(epayService, /return getSiteOrigin\(\)/);
  assert.match(epayService, /parsed\.protocol !== "https:"/);
});
