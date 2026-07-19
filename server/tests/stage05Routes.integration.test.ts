import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "stage-05-route-integration-secret";

test("stage 0.5 runtime routes reject student payment and digital category writes", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const originalFindUser = prisma.user.findUnique.bind(prisma.user);
  (prisma.user as any).findUnique = async ({ where }: { where: { id?: number } }) => where.id === 999_999
    ? { id: 999_999, username: "stage05-test", role: "admin", status: "active" }
    : originalFindUser({ where } as any);
  t.after(() => { (prisma.user as any).findUnique = originalFindUser; });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api", router);
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api/market`;
  const token = signToken({ userId: 999_999, studentId: "stage05-test", role: "admin", campus: "" });
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  for (const path of [
    "/items?page=abc&size=Infinity",
    "/wanted?page=abc&size=Infinity",
    "/materials/items?page=abc&size=Infinity",
    "/merchants?page=abc&size=Infinity",
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, `invalid pagination must fall back safely: ${path}`);
    const body = await response.json() as { data: { page: number; size: number } };
    assert.equal(body.data.page, 1);
    assert.ok(Number.isInteger(body.data.size));
  }
  for (const path of ["/items/not-a-number", "/wanted/not-a-number", "/materials/items/not-a-number"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 400, `invalid numeric IDs must not become 500 responses: ${path}`);
  }

  const payment = await fetch(`${baseUrl}/orders/1/pay`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ payType: "alipay" }),
  });
  assert.equal(payment.status, 403);
  assert.match(JSON.stringify(await payment.json()), /不经手学生商品款/);

  const payout = await fetch(`${baseUrl}/payout-profile`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ method: "alipay", account: "test@example.com", realName: "测试" }),
  });
  assert.equal(payout.status, 403);
  assert.match(JSON.stringify(await payout.json()), /不使用平台结算或提现/);

  const digitalCategory = await fetch(`${baseUrl}/admin/categories`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      slug: "stage05_digital",
      name: "测试数字品类",
      icon: "📁",
      description: "should be rejected",
      fulfillmentType: "digital",
      imageRequired: false,
      enabled: true,
      sort: 999,
    }),
  });
  assert.equal(digitalCategory.status, 400);

  const callback = await fetch(`${baseUrl}/payments/notify`, { method: "POST" });
  assert.equal(callback.status, 410);
  assert.equal(await callback.text(), "disabled");

  const paymentReturn = await fetch(`${baseUrl}/payments/return`, { redirect: "manual" });
  assert.equal(paymentReturn.status, 302);
  assert.match(paymentReturn.headers.get("location") || "", /payment=disabled/);
});
