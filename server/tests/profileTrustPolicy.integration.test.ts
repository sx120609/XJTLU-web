import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "profile-trust-policy-integration-secret";

test("profile trust uses listing status completion rate and admin-only complaint rating", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [seller, reporter, moderator, admin] = await Promise.all([
    prisma.user.create({
      data: {
        username: `trust_seller_${suffix}`,
        passwordHash: "not-used",
        nickname: `信用卖家_${suffix}`,
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
    prisma.user.create({
      data: {
        username: `trust_reporter_${suffix}`,
        passwordHash: "not-used",
        nickname: `投诉用户_${suffix}`,
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
    prisma.user.create({
      data: {
        username: `trust_mod_${suffix}`,
        passwordHash: "not-used",
        nickname: `版主_${suffix}`,
        role: "mod",
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
    prisma.user.create({
      data: {
        username: `trust_admin_${suffix}`,
        passwordHash: "not-used",
        nickname: `管理员_${suffix}`,
        role: "admin",
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
  ]);
  const userIds = [seller.id, reporter.id, moderator.id, admin.id];

  await prisma.marketItem.createMany({
    data: [
      {
        sellerId: seller.id,
        listingType: "sell",
        title: `在售商品_${suffix}`,
        description: "计入成交率分母",
        category: "other",
        deliveryType: "physical",
        priceCents: 1000,
        visibility: "public",
        status: "active",
      },
      ...[1, 2].map((index) => ({
        sellerId: seller.id,
        listingType: "sell",
        title: `已售商品${index}_${suffix}`,
        description: "同时计入成交率分子与分母",
        category: "other",
        deliveryType: "physical",
        priceCents: 1000 + index,
        visibility: "public",
        status: "sold",
        soldAt: new Date(),
      })),
      ...["draft", "withdrawn", "hidden"].map((status) => ({
        sellerId: seller.id,
        listingType: "sell",
        title: `${status}_${suffix}`,
        description: "不得计入成交率",
        category: "other",
        deliveryType: "physical",
        priceCents: 1200,
        visibility: "public",
        status,
      })),
      {
        sellerId: seller.id,
        listingType: "sell",
        title: `数字商品_${suffix}`,
        description: "非实物不得计入成交率",
        category: "digital_goods",
        deliveryType: "digital",
        priceCents: 1300,
        visibility: "public",
        status: "active",
      },
      {
        sellerId: seller.id,
        listingType: "sell",
        title: `定向商品_${suffix}`,
        description: "非公开商品不得计入成交率",
        category: "other",
        deliveryType: "physical",
        priceCents: 1400,
        visibility: "targeted",
        status: "active",
      },
    ],
  });

  t.after(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.marketReport.deleteMany({
      where: {
        OR: [
          { reporterId: { in: userIds } },
          { reportedUserId: { in: userIds } },
        ],
      },
    });
    await prisma.marketItem.deleteMany({ where: { sellerId: seller.id } });
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
  const token = (user: typeof seller) => signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });

  async function call(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
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

  const sellerToken = token(seller);
  const reporterToken = token(reporter);
  const moderatorToken = token(moderator);
  const adminToken = token(admin);

  const initialTrust = await api("/market/trust/me", sellerToken);
  assert.equal(initialTrust.physicalSellingItemCount, 1);
  assert.equal(initialTrust.physicalSoldItemCount, 2);
  assert.equal(initialTrust.physicalClosedTradeCount, 3);
  assert.equal(initialTrust.completionRate, 67);
  assert.equal(initialTrust.positiveRate, 100);

  const report = await api(`/market/users/${seller.id}/reports`, reporterToken, "POST", {
    reason: "交易投诉",
    detail: `管理员核验用投诉 ${suffix}`,
  });
  assert.equal(report.reportedUserId, seller.id);

  for (const deniedToken of [reporterToken, moderatorToken]) {
    const denied = await call(
      `/market/admin/users/${seller.id}/positive-rate`,
      deniedToken,
      "PATCH",
      { positiveRate: 72, reason: "无权修改", reportId: report.id },
    );
    assert.equal(denied.response.status, 403);
  }

  await api(`/market/admin/reports/${report.id}`, adminToken, "PATCH", {
    status: "resolved",
    note: "投诉核验成立",
    hideItem: false,
  });

  const adjusted = await api(
    `/market/admin/users/${seller.id}/positive-rate`,
    adminToken,
    "PATCH",
    {
      positiveRate: 72,
      reason: "投诉核验成立，管理员人工调整",
      reportId: report.id,
    },
  );
  assert.equal(adjusted.marketPositiveRate, 72);

  const [privateTrust, publicTrust, publicProfile, persisted, audit, notification] = await Promise.all([
    api("/market/trust/me", sellerToken),
    api(`/market/users/${seller.id}/trust`),
    api(`/market/users/${seller.id}/profile`),
    prisma.user.findUniqueOrThrow({ where: { id: seller.id } }),
    prisma.adminActionLog.findFirst({
      where: {
        actorId: admin.id,
        action: "market.positive_rate.adjust",
        targetType: "user",
        targetId: String(seller.id),
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.findFirst({
      where: {
        userId: seller.id,
        payload: { contains: "market-positive-rate-adjusted" },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  assert.equal(privateTrust.positiveRate, 72);
  assert.equal(publicTrust.positiveRate, 72);
  assert.equal(publicProfile.stats.positiveRate, 72);
  assert.equal(persisted.marketPositiveRate, 72);
  assert.equal(persisted.marketPositiveRateReason, "投诉核验成立，管理员人工调整");
  assert.ok(persisted.marketPositiveRateUpdatedAt);
  assert.ok(audit);
  assert.match(audit!.detail, /"reportId"/);
  assert.ok(notification);
});
