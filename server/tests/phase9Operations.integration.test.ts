import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-9-operations-secret";

test("stage 9 real routes require a matching manual receipt before revenue activation", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [seller, admin] = await Promise.all([
    ["seller", "user"],
    ["admin", "admin"],
  ].map(([label, role]) => prisma.user.create({
    data: {
      username: `phase9_${label}_${suffix}`,
      passwordHash: "not-used",
      nickname: `阶段九${label}_${suffix}`,
      role,
      studentSso: true,
      forumEnabled: true,
      aiReviewWhitelisted: true,
      dataAuthAgreedAt: new Date(),
    },
  })));
  const userIds = [seller.id, admin.id];
  const item = await prisma.marketItem.create({
    data: {
      sellerId: seller.id,
      listingType: "sell",
      title: `阶段九人工核验商品 ${suffix}`,
      description: "用于验证平台推广盈利订单的管理员人工确认流程",
      category: "other",
      deliveryType: "physical",
      priceCents: 9_900,
      condition: "good",
      tradeMode: "meetup",
      campus: "SIP",
      location: "中心楼大堂",
      flaws: "轻微使用痕迹",
      availableTime: "工作日晚上",
      visibility: "public",
      status: "active",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
  });

  t.after(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.promotionOrder.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketItem.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const token = (user: typeof seller) => signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "SIP" });
  const sellerToken = token(seller);
  const adminToken = token(admin);

  async function call(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await response.json() as { code: number; data: any; message: string };
    return { response, body };
  }

  async function api(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const result = await call(path, bearer, method, payload);
    assert.equal(result.response.status, 200, `${method} ${path}: ${result.body.message}`);
    assert.equal(result.body.code, 0, `${method} ${path}: ${result.body.message}`);
    return result.body.data;
  }

  const order = await api("/market/promotions/orders", sellerToken, "POST", { planCode: "listing_pin_7d", targetId: item.id, note: "阶段九核验" });
  assert.equal(order.paymentMode, "manual");
  assert.equal(order.status, "pending");
  assert.match(order.paymentCode, /^\d{4}$/);
  const claimed = await api(`/market/promotions/orders/${order.id}/payment-claim`, sellerToken, "POST", { paymentCode: order.paymentCode });
  assert.ok(claimed.paymentSubmittedAt);

  const unauthorizedAdmin = await call(`/market/admin/promotions/orders/${order.id}`, sellerToken, "PATCH", {
    action: "confirm", verificationMethod: "alipay", verificationReference: "DENIED", verifiedAmount: Number(order.amount), paymentCode: order.paymentCode, note: "普通用户不得确认",
  });
  assert.equal(unauthorizedAdmin.response.status, 403);

  const mismatch = await call(`/market/admin/promotions/orders/${order.id}`, adminToken, "PATCH", {
    action: "confirm",
    verificationMethod: "alipay",
    verificationReference: `P9-WRONG-${suffix}`,
    verifiedAmount: Number(order.amount) + 1,
    paymentCode: order.paymentCode,
    note: "金额不一致时必须失败",
  });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.body.message, /金额/);
  assert.equal((await prisma.promotionOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "pending");

  const reference = `P9-ALIPAY-${suffix}`;
  const confirmed = await api(`/market/admin/promotions/orders/${order.id}`, adminToken, "PATCH", {
    action: "confirm",
    verificationMethod: "alipay",
    verificationReference: reference,
    verifiedAmount: Number(order.amount),
    paymentCode: order.paymentCode,
    note: "已核对推广对象、订单金额和线下收款记录",
  });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.verificationReference, reference);
  assert.equal(confirmed.verifiedAmountCents, order.amountCents);
  assert.equal((await prisma.marketItem.findUniqueOrThrow({ where: { id: item.id } })).pinnedPromotionOrderId, order.id);

  const ownOrders = await api("/market/promotions/orders", sellerToken);
  const ownOrder = ownOrders.list.find((row: any) => row.id === order.id);
  assert.equal("verificationReference" in ownOrder, false);
  assert.equal(ownOrder.paymentCode, order.paymentCode);
  assert.equal(ownOrder.verificationReferenceMasked.endsWith(reference.slice(-4)), true);
  const adminOrders = await api(`/market/admin/promotions/orders?q=${encodeURIComponent(order.outTradeNo)}`, adminToken);
  assert.equal(adminOrders.list[0].verificationReference, reference);

  const denied = await call("/market/admin/operations?days=30", sellerToken);
  assert.equal(denied.response.status, 403);
  const dashboard = await api("/market/admin/operations?days=30", adminToken);
  assert.deepEqual(dashboard.funnels.map((funnel: any) => funnel.key), ["trade", "wanted", "learning", "promotion"]);
  assert.ok(dashboard.headline.promotionRevenueCents >= order.amountCents);
  assert.ok(dashboard.timeline.some((entry: any) => entry.kind === "action" && entry.target.includes(String(order.id))));
  const audit = await prisma.adminActionLog.findFirstOrThrow({ where: { actorId: admin.id, targetType: "promotion_order", targetId: String(order.id) } });
  assert.equal(audit.detail.includes(reference), false);
  assert.equal(audit.detail.includes(reference.slice(-4)), true);
  assert.equal(audit.detail.includes(order.paymentCode), false);
});
