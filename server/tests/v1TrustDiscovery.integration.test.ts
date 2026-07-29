import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "v1-trust-discovery-integration-secret";

test("V1 point ledger, trust profile, activity aggregation and readiness routes use real PostgreSQL", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const {
    awardTransactionPoints,
    restoreViolationPointsInTransaction,
  } = await import("../src/services/transactionPoints");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [user, admin] = await Promise.all([
    prisma.user.create({
      data: {
        username: `v1_user_${suffix}`,
        passwordHash: "not-used",
        nickname: `V1 用户 ${suffix}`,
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
    prisma.user.create({
      data: {
        username: `v1_admin_${suffix}`,
        passwordHash: "not-used",
        nickname: `V1 管理员 ${suffix}`,
        role: "admin",
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
  ]);
  const item = await prisma.marketItem.create({
    data: {
      sellerId: user.id,
      listingType: "sell",
      title: `V1 热门排序商品 ${suffix}`,
      description: "V1 集成测试真实在售商品",
      category: "other",
      deliveryType: "physical",
      priceCents: 1000,
      condition: "good",
      tradeMode: "meetup",
      campus: "SIP",
      location: "中心楼",
      flaws: "无",
      availableTime: "工作日",
      visibility: "public",
      status: "active",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  t.after(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [user.id, admin.id] } } });
    await prisma.marketItem.deleteMany({ where: { id: item.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } });
  });

  const sameEvent = {
    userId: user.id,
    delta: 20,
    event: "integration_completed",
    sourceType: "integration",
    sourceId: suffix,
    reason: "V1 幂等积分测试",
  };
  const concurrent = await Promise.all([
    awardTransactionPoints(sameEvent),
    awardTransactionPoints(sameEvent),
  ]);
  assert.equal(concurrent.filter((result) => result.applied).length, 1);
  assert.equal(
    await prisma.transactionPointEntry.count({
      where: {
        userId: user.id,
        event: sameEvent.event,
        sourceType: sameEvent.sourceType,
        sourceId: sameEvent.sourceId,
      },
    }),
    1,
  );
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).transactionPoints, 20);

  await awardTransactionPoints({
    userId: user.id,
    delta: -50,
    event: "market_violation",
    sourceType: "market_violation",
    sourceId: suffix,
    reason: "V1 扣分下限测试",
  });
  const penalty = await prisma.transactionPointEntry.findUniqueOrThrow({
    where: {
      userId_event_sourceType_sourceId: {
        userId: user.id,
        event: "market_violation",
        sourceType: "market_violation",
        sourceId: suffix,
      },
    },
  });
  assert.equal(penalty.delta, -20);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).transactionPoints, 0);

  await prisma.$transaction((tx) => restoreViolationPointsInTransaction(tx, {
    userId: user.id,
    originalEvent: "market_violation",
    restoreEvent: "market_violation_restored",
    sourceType: "market_violation",
    sourceId: suffix,
    reason: "V1 申诉返还测试",
  }));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).transactionPoints, 20);

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = (row: typeof user) => signToken({
    userId: row.id,
    studentId: row.username,
    role: row.role,
    campus: "SIP",
  });
  const userToken = token(user);
  const adminToken = token(admin);

  async function api(path: string, bearer?: string, method = "GET", payload?: unknown) {
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
    assert.equal(response.status, 200, `${method} ${path}: ${body.message}`);
    assert.equal(body.code, 0, `${method} ${path}: ${body.message}`);
    return body.data;
  }

  const firstActivity = await api("/product/activity", userToken, "POST", {
    surface: "market",
    source: "schedule",
  });
  const secondActivity = await api("/product/activity", userToken, "POST", {
    surface: "market",
    source: "schedule",
  });
  assert.equal(firstActivity.visitCount, 1);
  assert.equal(secondActivity.visitCount, 2);

  const privateTrust = await api("/market/trust/me", userToken);
  assert.equal(privateTrust.transactionPoints.points, 20);
  assert.ok(privateTrust.transactionPoints.recentEntries.length >= 3);
  assert.equal(privateTrust.identity.verified, true);
  const publicTrust = await api(`/market/users/${user.id}/trust`);
  assert.equal(publicTrust.transactionPoints.points, 20);
  assert.equal(publicTrust.transactionPoints.recentEntries, undefined);

  const dashboard = await api("/market/admin/operations?days=7", adminToken);
  assert.equal(typeof dashboard.product.dau, "number");
  assert.equal(typeof dashboard.product.wau, "number");
  assert.ok(dashboard.product.surfaceActiveUsers.some((row: any) => row.surface === "market" && row.users >= 1));
  assert.ok(dashboard.readiness.checks.some((row: any) => row.key === "runtime_health"));
  assert.match(dashboard.readiness.note, /数据库迁移校验/);
});
