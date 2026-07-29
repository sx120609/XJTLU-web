import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "admin-payment-integration-secret";

test("sponsor admin updates and gateway callbacks share an idempotent state machine", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { prisma } = await import("../src/prisma");
  const { signToken } = await import("../src/utils/jwt");
  const { signEpayParams } = await import("../src/services/epay");
  const {
    closeSponsorOrder,
    handleSponsorPaymentNotification,
    sponsorPaymentReturnTarget,
  } = await import("../src/services/sponsorPaymentService");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const merchant = {
    pid: `payment_pid_${suffix}`,
    merchantKey: `payment_key_${suffix}`,
  };
  const originalEpay = await prisma.epayConfig.findUnique({
    where: { id: 1 },
  });
  const [admin, user] = await Promise.all([
    prisma.user.create({
      data: {
        username: `admin_payment_admin_${suffix}`,
        passwordHash: "not-used",
        nickname: "支付集成管理员",
        role: "admin",
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_payment_user_${suffix}`,
        passwordHash: "not-used",
        nickname: "支付集成用户",
      },
    }),
  ]);
  await prisma.epayConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      enabled: true,
      gatewayUrl: "https://pay.example.test",
      pid: merchant.pid,
      merchantKey: merchant.merchantKey,
      signType: "MD5",
      defaultType: "alipay",
      enabledTypes: "[\"alipay\"]",
    },
    update: {
      enabled: true,
      gatewayUrl: "https://pay.example.test",
      pid: merchant.pid,
      merchantKey: merchant.merchantKey,
      signType: "MD5",
      defaultType: "alipay",
      enabledTypes: "[\"alipay\"]",
    },
  });
  const manualOrder = await prisma.sponsorOrder.create({
    data: {
      userId: user.id,
      outTradeNo: `SP-MANUAL-${suffix}`,
      payType: "alipay",
      amountCents: 500,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const callbackOrder = await prisma.sponsorOrder.create({
    data: {
      userId: user.id,
      outTradeNo: `SP-CALLBACK-${suffix}`,
      payType: "alipay",
      amountCents: 700,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const orderIds = [manualOrder.id, callbackOrder.id];
  const tradeNos = [manualOrder.outTradeNo, callbackOrder.outTradeNo];

  t.after(async () => {
    await prisma.notification.deleteMany({
      where: {
        OR: tradeNos.map((outTradeNo) => ({
          payload: { contains: outTradeNo },
        })),
      },
    });
    await prisma.adminActionLog.deleteMany({
      where: {
        targetType: "sponsor_order",
        targetId: { in: orderIds.map(String) },
      },
    });
    await prisma.sponsorPaymentLog.deleteMany({
      where: { outTradeNo: { in: tradeNos } },
    });
    await prisma.sponsorOrder.deleteMany({
      where: { id: { in: orderIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, user.id] } },
    });
    if (originalEpay) {
      await prisma.epayConfig.update({
        where: { id: 1 },
        data: {
          enabled: originalEpay.enabled,
          gatewayUrl: originalEpay.gatewayUrl,
          pid: originalEpay.pid,
          merchantKey: originalEpay.merchantKey,
          signType: originalEpay.signType,
          defaultType: originalEpay.defaultType,
          enabledTypes: originalEpay.enabledTypes,
          notifyUrl: originalEpay.notifyUrl,
          returnUrl: originalEpay.returnUrl,
        },
      });
    } else {
      await prisma.epayConfig.deleteMany({ where: { id: 1 } });
    }
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const adminToken = signToken({
    userId: admin.id,
    studentId: admin.username,
    role: admin.role,
    campus: "SIP",
  });

  async function patchOrder(
    orderId: number,
    payload: unknown,
  ) {
    const response = await fetch(`${baseUrl}/sponsor-orders/${orderId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as {
      code: number;
      data: unknown;
      message: string;
    };
    return { response, body };
  }

  const missingAuditNote = await patchOrder(manualOrder.id, {
    status: "paid",
  });
  assert.equal(missingAuditNote.response.status, 400);

  const concurrentManual = await Promise.all([
    patchOrder(manualOrder.id, {
      status: "paid",
      adminNote: "人工核对流水 A",
    }),
    patchOrder(manualOrder.id, {
      status: "paid",
      adminNote: "人工核对流水 B",
    }),
  ]);
  assert.deepEqual(
    concurrentManual.map(({ response }) => response.status),
    [200, 200],
  );
  assert.equal(
    (await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { sponsorTotalCents: true },
    })).sponsorTotalCents,
    500,
  );
  assert.equal(
    await prisma.adminActionLog.count({
      where: {
        action: "sponsor.order.update",
        targetId: String(manualOrder.id),
      },
    }),
    2,
  );

  const paidDowngrade = await patchOrder(manualOrder.id, {
    status: "closed",
  });
  assert.equal(paidDowngrade.response.status, 409);
  assert.equal(
    (await prisma.sponsorOrder.findUniqueOrThrow({
      where: { id: manualOrder.id },
      select: { status: true },
    })).status,
    "paid",
  );

  const callbackParams: Record<string, string> = {
    pid: merchant.pid,
    out_trade_no: callbackOrder.outTradeNo,
    trade_no: `GATEWAY-${suffix}`,
    trade_status: "TRADE_SUCCESS",
    type: "alipay",
    money: "7.00",
  };
  callbackParams.sign = signEpayParams(
    callbackParams,
    merchant.merchantKey,
  );
  callbackParams.sign_type = "MD5";

  const closeAndCallback = await Promise.allSettled([
    closeSponsorOrder(
      { userId: user.id },
      callbackOrder.outTradeNo,
    ),
    handleSponsorPaymentNotification(callbackParams),
  ]);
  assert.equal(closeAndCallback[1].status, "fulfilled");
  assert.equal(
    (await prisma.sponsorOrder.findUniqueOrThrow({
      where: { id: callbackOrder.id },
      select: { status: true },
    })).status,
    "paid",
  );
  const duplicate = await handleSponsorPaymentNotification(callbackParams);
  assert.deepEqual(duplicate, { status: 200, body: "success" });
  assert.equal(
    (await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { sponsorTotalCents: true },
    })).sponsorTotalCents,
    1_200,
  );

  const wrongMerchantParams = {
    ...callbackParams,
    pid: "wrong-merchant",
    sign: "",
  };
  wrongMerchantParams.sign = signEpayParams(
    wrongMerchantParams,
    merchant.merchantKey,
  );
  assert.deepEqual(
    await handleSponsorPaymentNotification(wrongMerchantParams),
    { status: 400, body: "fail" },
  );
  assert.match(
    await sponsorPaymentReturnTarget(wrongMerchantParams),
    /sponsor=pending/,
  );
  assert.match(
    await sponsorPaymentReturnTarget(callbackParams),
    /sponsor=success/,
  );
});
