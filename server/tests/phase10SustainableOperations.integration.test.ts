import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-10-sustainable-secret";

test("stage 10 real routes enforce inventory, renewal, manual after-service records and commercial shutdown", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const { isFeatureOn, setFeature } = await import("../src/services/siteSettings");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const users = await Promise.all([
    ["seller_a", "user"],
    ["seller_b", "user"],
    ["admin", "admin"],
  ].map(([label, role]) => prisma.user.create({ data: { username: `phase10_${label}_${suffix}`, passwordHash: "not-used", nickname: `阶段十${label}_${suffix}`, role, studentSso: true, forumEnabled: true, aiReviewWhitelisted: true, dataAuthAgreedAt: new Date() } })));
  const [sellerA, sellerB, admin] = users;
  const userIds = users.map((user) => user.id);
  const plan = await prisma.promotionPlan.findUniqueOrThrow({ where: { code: "listing_pin_7d" } });
  const previousFeature = isFeatureOn("promotion");
  await setFeature("promotion", true);
  const preexistingActiveSlots = await prisma.promotionOrder.count({ where: { type: "listing_pin", status: "confirmed", startsAt: { lte: new Date() }, expiresAt: { gt: new Date() } } });
  await prisma.promotionPlan.update({ where: { id: plan.id }, data: { maxActive: preexistingActiveSlots + 1, manualCostCents: 150 } });

  const items = await Promise.all([sellerA, sellerB].map((seller, index) => prisma.marketItem.create({ data: { sellerId: seller.id, listingType: "sell", title: `阶段十库存商品 ${index} ${suffix}`, description: "用于验证推广库存、续期和人工售后记录", category: "other", deliveryType: "physical", priceCents: 8_800 + index, condition: "good", tradeMode: "meetup", campus: "SIP", location: "中心楼", flaws: "轻微使用痕迹", availableTime: "工作日晚上", visibility: "public", status: "active", expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000) } })));
  const merchant = await prisma.merchantProfile.create({ data: { userId: sellerA.id, slug: `phase10-${suffix.replace(/_/g, "-")}`.toLowerCase(), name: `阶段十商户 ${suffix}`, category: "校园服务", description: "真实服务资料用于验证九十天周期复核，不创建任何演示订单。", priceRange: "按次报价", serviceArea: "SIP 校区", contactMethod: "wechat", contactValueEncrypted: "test", contactValueMasked: "w***t", status: "reviewing" } });

  t.after(async () => {
    await setFeature("promotion", previousFeature);
    await prisma.promotionPlan.update({ where: { id: plan.id }, data: { maxActive: plan.maxActive, manualCostCents: plan.manualCostCents } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.promotionOrder.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.merchantProfile.deleteMany({ where: { userId: { in: userIds } } });
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
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = (user: typeof sellerA) => signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "SIP" });
  const sellerAToken = token(sellerA), sellerBToken = token(sellerB), adminToken = token(admin);

  async function call(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, { method, signal: AbortSignal.timeout(20_000), headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const body = await response.json() as { code: number; data: any; message: string };
    return { response, body };
  }
  async function api(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const result = await call(path, bearer, method, payload);
    assert.equal(result.response.status, 200, `${method} ${path}: ${result.body.message}`);
    assert.equal(result.body.code, 0, `${method} ${path}: ${result.body.message}`);
    return result.body.data;
  }
  async function createAndConfirm(sellerToken: string, itemId: number, reference: string) {
    const order = await api("/market/promotions/orders", sellerToken, "POST", { planCode: plan.code, targetId: itemId, note: "阶段十真实流程" });
    const confirmed = await api(`/market/admin/promotions/orders/${order.id}`, adminToken, "PATCH", { action: "confirm", verificationMethod: "bank", verificationReference: reference, verifiedAmount: Number(order.amount), note: "已逐单核对收款和推广对象" });
    return confirmed;
  }

  const first = await createAndConfirm(sellerAToken, items[0].id, `P10-FIRST-${suffix}`);
  assert.equal(first.manualCostCents, 150);
  const secondPending = await api("/market/promotions/orders", sellerBToken, "POST", { planCode: plan.code, targetId: items[1].id, note: "库存应拦截" });
  const capacity = await call(`/market/admin/promotions/orders/${secondPending.id}`, adminToken, "PATCH", { action: "confirm", verificationMethod: "bank", verificationReference: `P10-FULL-${suffix}`, verifiedAmount: Number(secondPending.amount), note: "库存已满时不得确认" });
  assert.equal(capacity.response.status, 409);
  assert.match(capacity.body.message, /库存/);

  const renewal = await createAndConfirm(sellerAToken, items[0].id, `P10-RENEW-${suffix}`);
  assert.equal((await prisma.promotionOrder.findUniqueOrThrow({ where: { id: first.id } })).status, "expired");
  assert.ok(new Date(renewal.expiresAt).getTime() > new Date(first.expiresAt).getTime());

  const extended = await api(`/market/admin/promotions/orders/${renewal.id}/adjustments`, adminToken, "POST", { type: "service_extension", extensionDays: 2, note: "人工补偿两天展示时间" });
  assert.ok(new Date(extended.expiresAt).getTime() > new Date(renewal.expiresAt).getTime());
  const refundReference = `P10-REFUND-${suffix}`;
  const adjusted = await api(`/market/admin/promotions/orders/${renewal.id}/adjustments`, adminToken, "POST", { type: "refund_record", amount: 1, reference: refundReference, note: "已在线下渠道完成部分退款" });
  assert.equal(adjusted.adjustments.length, 2);

  const ownOrders = await api("/market/promotions/orders", sellerAToken);
  const ownRenewal = ownOrders.list.find((row: any) => row.id === renewal.id);
  assert.equal(ownRenewal.adjustments[1].reference, undefined);
  assert.equal(ownRenewal.adjustments[1].referenceMasked.endsWith(refundReference.slice(-4)), true);
  const audit = await prisma.adminActionLog.findFirstOrThrow({ where: { actorId: admin.id, action: "promotion_adjustment", targetId: String(renewal.id) }, orderBy: { createdAt: "desc" } });
  assert.equal(audit.detail.includes(refundReference), false);
  assert.equal(audit.detail.includes(refundReference.slice(-4)), true);

  const reviewedMerchant = await api(`/market/admin/merchants/${merchant.id}`, adminToken, "PATCH", { status: "approved", note: "资料真实合规，进入周期复核" });
  const reviewDays = (new Date(reviewedMerchant.reviewDueAt).getTime() - Date.now()) / 86_400_000;
  assert.ok(reviewDays > 89 && reviewDays <= 90.1);
  const dashboard = await api("/market/admin/operations?days=30", adminToken);
  assert.ok(dashboard.headline.promotionManualCostCents >= 150);
  assert.equal(typeof dashboard.headline.promotionNetContribution, "string");

  await api("/admin/features", adminToken, "PATCH", { promotion: false });
  assert.deepEqual(await api("/market/promotions/plans"), []);
  const coreItem = await api(`/market/items/${items[0].id}`, sellerAToken);
  assert.equal(coreItem.id, items[0].id);
  assert.equal(coreItem.promotions.promoted, false);
  await api("/admin/features", adminToken, "PATCH", { promotion: true });
});
