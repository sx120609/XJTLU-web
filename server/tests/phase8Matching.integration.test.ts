import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-8-matching-secret";

test("stage 8 real routes match public listings, persist preferences and keep fulfillment in direct chat", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const { notifyMatchesForItem } = await import("../src/services/marketMatching");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [seller, buyer] = await Promise.all(["seller", "buyer"].map((label) => prisma.user.create({
    data: {
      username: `phase8_${label}_${suffix}`,
      passwordHash: "not-used",
      nickname: `阶段八${label}_${suffix}`,
      role: "user",
      studentSso: true,
      forumEnabled: true,
      aiReviewWhitelisted: true,
      dataAuthAgreedAt: new Date(),
    },
  })));
  const userIds = [seller.id, buyer.id];
  const item = await prisma.marketItem.create({
    data: {
      sellerId: seller.id,
      listingType: "sell",
      title: `索尼 XM5 降噪耳机 ${suffix}`,
      description: "功能正常，支持校内当面测试",
      category: "digital",
      deliveryType: "physical",
      priceCents: 150_000,
      condition: "good",
      tradeMode: "meetup",
      campus: "SIP",
      location: "中心楼大堂",
      brand: "Sony",
      model: "WH-1000XM5",
      flaws: "轻微使用痕迹",
      availableTime: "工作日晚上",
      visibility: "public",
      status: "active",
      expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60_000),
    },
  });
  const wanted = await prisma.wantedPost.create({
    data: {
      authorId: buyer.id,
      title: `求购索尼 XM5 耳机 ${suffix}`,
      description: "需要降噪功能正常，可当面测试",
      category: "digital",
      budgetMinCents: 120_000,
      budgetMaxCents: 180_000,
      brandModel: "Sony WH-1000XM5",
      condition: "使用良好",
      expectedTradeTime: "本周",
      campus: "SIP",
      location: "中心楼大堂",
      status: "active",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
    },
  });

  t.after(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketMatchNotice.deleteMany({ where: { recipientId: { in: userIds } } });
    await prisma.transactionPointEntry.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketConversation.deleteMany({ where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } });
    await prisma.marketOrder.deleteMany({ where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } });
    await prisma.marketPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wantedPost.deleteMany({ where: { authorId: { in: userIds } } });
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

  const itemMatches = await api(`/market/items/${item.id}/matches`);
  assert.equal(itemMatches[0].wantedPost.id, wanted.id);
  assert.ok(itemMatches[0].score >= 80);
  assert.ok(itemMatches[0].reasons.every((reason: any) => reason.key && reason.label && reason.points > 0));
  assert.equal(JSON.stringify(itemMatches).includes(buyer.username), false);
  const wantedMatches = await api(`/market/wanted/${wanted.id}/matches`);
  assert.equal(wantedMatches[0].item.id, item.id);

  const buyerToken = token(buyer);
  const sellerToken = token(seller);
  const defaults = await api("/market/preferences", buyerToken);
  assert.equal(defaults.matchNotificationsEnabled, true);
  assert.equal("meetupRemindersEnabled" in defaults, false);
  const invalidPreference = await call("/market/preferences", buyerToken, "PATCH", { meetupRemindersEnabled: false });
  assert.equal(invalidPreference.response.status, 400);
  const preference = await api("/market/preferences", buyerToken, "PATCH", { matchNotificationsEnabled: false });
  assert.equal(preference.matchNotificationsEnabled, false);

  await api("/market/preferences", buyerToken, "PATCH", { matchNotificationsEnabled: true });
  assert.equal(await notifyMatchesForItem(item.id), 1);
  assert.equal(await notifyMatchesForItem(item.id), 0);
  assert.equal(await prisma.marketMatchNotice.count({ where: { itemId: item.id, wantedPostId: wanted.id, recipientId: buyer.id } }), 1);

  const conversation = await api(
    `/market/items/${item.id}/conversations`,
    buyerToken,
    "POST",
    { message: "匹配结果合适，直接私聊确认。" },
  );
  const negotiating = await prisma.marketOrder.findUniqueOrThrow({
    where: { id: conversation.orderId },
  });
  assert.equal(negotiating.status, "negotiating");
  assert.equal(negotiating.meetupTime, null);
  assert.equal(negotiating.meetupLocation, "");
  await Promise.all([
    api(`/market/orders/${negotiating.id}`, buyerToken, "PATCH", { action: "buyer_confirm" }),
    api(`/market/orders/${negotiating.id}`, sellerToken, "PATCH", { action: "seller_confirm" }),
  ]);
  assert.equal(
    (await prisma.marketOrder.findUniqueOrThrow({ where: { id: negotiating.id } })).status,
    "completed",
  );
  assert.equal(
    await prisma.notification.count({
      where: {
        userId: { in: userIds },
        payload: { contains: "market-meetup-reminder" },
      },
    }),
    0,
  );
});
