import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "simplified-v1-integration-secret";

test("simplified V1 completes direct trades, free anonymity, reserved point promotion, unique views and reputation appeals", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const users = await Promise.all([
    ["seller", "实体卖家", "user"],
    ["buyer", "实体买家", "user"],
    ["responder", "求购响应者", "user"],
    ["admin", "治理管理员", "admin"],
  ].map(([key, label, role]) => prisma.user.create({
    data: {
      username: `simple_v1_${key}_${suffix}`,
      passwordHash: "not-used",
      nickname: `${label}_${suffix}`,
      role,
      studentSso: true,
      forumEnabled: true,
      anonymousCredits: 0,
      anonymousCreditsFrozen: true,
      aiReviewWhitelisted: true,
      dataAuthAgreedAt: new Date(),
    },
  })));
  const [seller, buyer, responder, admin] = users;
  const userIds = users.map((user) => user.id);
  const topicIds: number[] = [];
  const itemIds: number[] = [];
  const wantedPostIds: number[] = [];
  const violationIds: number[] = [];

  t.after(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pointBoost.deleteMany({ where: { userId: { in: userIds } } });
    if (topicIds.length) {
      await prisma.contentViewDaily.deleteMany({
        where: { targetType: "topic", targetId: { in: topicIds } },
      });
    }
    await prisma.marketAppeal.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketViolation.deleteMany({
      where: {
        OR: [
          { id: { in: violationIds.length ? violationIds : [-1] } },
          { userId: { in: userIds } },
          { createdById: { in: userIds } },
        ],
      },
    });
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.marketConversation.deleteMany({
      where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
    });
    await prisma.marketOrder.deleteMany({
      where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
    });
    await prisma.wantedResponse.deleteMany({ where: { sellerId: { in: userIds } } });
    if (wantedPostIds.length) {
      await prisma.wantedPost.deleteMany({ where: { id: { in: wantedPostIds } } });
    }
    if (itemIds.length) {
      await prisma.marketItem.deleteMany({ where: { id: { in: itemIds } } });
    }
    await prisma.transactionPointEntry.deleteMany({ where: { userId: { in: userIds } } });
    if (topicIds.length) {
      await prisma.topic.deleteMany({ where: { id: { in: topicIds } } });
      await prisma.board.updateMany({
        where: { slug: "general" },
        data: { topicCount: { decrement: topicIds.length } },
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use("/api/*", (_req, res) => {
    res.status(404).json({ code: 4004, data: null, message: "接口不存在" });
  });
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const token = (user: typeof seller) => signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });
  const sellerToken = token(seller);
  const buyerToken = token(buyer);
  const responderToken = token(responder);
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

  const anonymousTopic = await api("/topics", sellerToken, "POST", {
    boardSlug: "general",
    title: `免费匿名与热度测试 ${suffix}`,
    content: "匿名发布不消耗积分，重复刷新不重复增加浏览。",
    anonymous: true,
  });
  topicIds.push(anonymousTopic.id);
  assert.equal(anonymousTopic.isAnonymous, true);
  const sellerAfterPost = await prisma.user.findUniqueOrThrow({ where: { id: seller.id } });
  assert.equal(sellerAfterPost.anonymousCredits, 0);
  assert.equal(sellerAfterPost.transactionPoints, 0);

  await api(`/topics/${anonymousTopic.id}`, sellerToken);
  await api(`/topics/${anonymousTopic.id}`, sellerToken);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const viewedTopic = await prisma.topic.findUniqueOrThrow({ where: { id: anonymousTopic.id } });
  assert.equal(viewedTopic.viewCount, 1);
  assert.ok(viewedTopic.hotScore >= 0 && viewedTopic.hotScore <= 100);
  assert.equal(await prisma.contentViewDaily.count({
    where: { targetType: "topic", targetId: anonymousTopic.id },
  }), 1);

  const item = await prisma.marketItem.create({
    data: {
      sellerId: seller.id,
      listingType: "sell",
      title: `直接私聊商品 ${suffix}`,
      description: "用于验证直接私聊与双方确认成交",
      category: "other",
      deliveryType: "physical",
      priceCents: 8800,
      condition: "good",
      tradeMode: "meetup",
      campus: "SIP",
      location: "中心楼",
      flaws: "无",
      availableTime: "工作日晚上",
      visibility: "public",
      status: "active",
    },
  });
  itemIds.push(item.id);

  const legacyIntent = await call(
    `/market/items/${item.id}/intents`,
    buyerToken,
    "POST",
    { price: 80, availableTime: "今晚" },
  );
  assert.equal(legacyIntent.response.status, 404);

  const conversation = await api(
    `/market/items/${item.id}/conversations`,
    buyerToken,
    "POST",
    { message: "你好，我想当面看看。" },
  );
  const duplicateConversation = await api(
    `/market/items/${item.id}/conversations`,
    buyerToken,
    "POST",
    {},
  );
  assert.equal(duplicateConversation.id, conversation.id);
  const directOrder = await prisma.marketOrder.findUniqueOrThrow({
    where: { id: conversation.orderId },
  });
  assert.equal(directOrder.status, "negotiating");
  assert.equal(directOrder.tradeIntentId, null);
  assert.equal(directOrder.offerId, null);

  const buyerConfirmation = await api(
    `/market/conversations/${conversation.id}/confirm-completion`,
    buyerToken,
    "POST",
  );
  assert.equal(buyerConfirmation.completed, false);
  assert.equal(buyerConfirmation.pointsIssued, false);
  assert.ok(buyerConfirmation.buyerConfirmedAt);
  assert.equal(buyerConfirmation.sellerConfirmedAt, null);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).transactionPoints, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).transactionPoints, 0);

  const sellerConfirmation = await api(
    `/market/conversations/${conversation.id}/confirm-completion`,
    sellerToken,
    "POST",
  );
  assert.equal(sellerConfirmation.completed, true);
  assert.equal(sellerConfirmation.pointsIssued, true);
  assert.deepEqual(sellerConfirmation.rewards, { buyer: 10, seller: 10 });
  const completedOrder = await prisma.marketOrder.findUniqueOrThrow({ where: { id: directOrder.id } });
  assert.equal(completedOrder.status, "completed");
  assert.ok(completedOrder.buyerConfirmedAt);
  assert.ok(completedOrder.sellerConfirmedAt);
  assert.equal((await prisma.marketItem.findUniqueOrThrow({ where: { id: item.id } })).status, "sold");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).transactionPoints, 10);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).transactionPoints, 10);
  const repeatedConfirmations = await Promise.all([
    api(`/market/conversations/${conversation.id}/confirm-completion`, buyerToken, "POST"),
    api(`/market/conversations/${conversation.id}/confirm-completion`, sellerToken, "POST"),
  ]);
  assert.ok(repeatedConfirmations.every((result) => result.completed && result.pointsIssued));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).transactionPoints, 10);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).transactionPoints, 10);
  assert.equal(await prisma.transactionPointEntry.count({
    where: { sourceType: "market_order", sourceId: String(directOrder.id) },
  }), 2);
  const closedConversationSend = await call(
    `/market/conversations/${conversation.id}/messages`,
    buyerToken,
    "POST",
    {
      content: "成交完成后不应继续发送",
      clientMessageId: `closed-chat-${suffix}`,
    },
  );
  assert.equal(closedConversationSend.response.status, 409);
  assert.match(closedConversationSend.body.message, /私聊已关闭/);
  const closedConversationRestart = await call(
    `/market/items/${item.id}/conversations`,
    buyerToken,
    "POST",
    { message: "也不能绕过新建会话继续发送" },
  );
  assert.equal(closedConversationRestart.response.status, 409);
  assert.match(closedConversationRestart.body.message, /私聊已关闭/);

  const boostRace = await Promise.all([
    call("/market/points/boosts", sellerToken, "POST", {
      targetType: "topic",
      targetId: anonymousTopic.id,
    }),
    call("/market/points/boosts", sellerToken, "POST", {
      targetType: "topic",
      targetId: anonymousTopic.id,
    }),
  ]);
  assert.deepEqual(
    boostRace.map((result) => result.response.status).sort((a, b) => a - b),
    [409, 409],
  );
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).transactionPoints, 10);
  assert.equal(await prisma.pointBoost.count({
    where: { targetType: "topic", targetId: anonymousTopic.id },
  }), 0);
  assert.equal((await prisma.topic.findUniqueOrThrow({ where: { id: anonymousTopic.id } })).boostedUntil, null);
  const promotionConfig = await api("/market/points/promotion/config", sellerToken);
  assert.equal(promotionConfig.enabled, false);
  assert.equal(promotionConfig.status, "designing");
  assert.deepEqual(promotionConfig.mechanisms, []);
  const promotionContext = await api(
    `/market/points/promotion/context?targetType=topic&targetId=${anonymousTopic.id}`,
    sellerToken,
  );
  assert.equal(promotionContext.pointBalance, 10);
  assert.equal(promotionContext.target.id, anonymousTopic.id);
  assert.equal(promotionContext.target.eligible, true);

  const wanted = await prisma.wantedPost.create({
    data: {
      authorId: buyer.id,
      title: `直接私聊求购 ${suffix}`,
      category: "other",
      budgetMinCents: 5000,
      budgetMaxCents: 12000,
      description: "验证求购响应不会生成预约",
      campus: "SIP",
      location: "中心楼",
      expectedTradeTime: "本周",
      status: "responded",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });
  wantedPostIds.push(wanted.id);
  const targetedItem = await prisma.marketItem.create({
    data: {
      sellerId: responder.id,
      listingType: "sell",
      title: `求购响应物品 ${suffix}`,
      description: "响应求购的定向商品",
      category: "other",
      deliveryType: "physical",
      priceCents: 7600,
      condition: "good",
      tradeMode: "meetup",
      campus: "SIP",
      location: "中心楼",
      flaws: "无",
      availableTime: "周末",
      visibility: "targeted",
      sourceWantedPostId: wanted.id,
      status: "targeted",
    },
  });
  itemIds.push(targetedItem.id);
  const wantedResponse = await prisma.wantedResponse.create({
    data: {
      wantedPostId: wanted.id,
      sellerId: responder.id,
      itemId: targetedItem.id,
      priceCents: 7600,
      description: "功能正常",
      availableTime: "周末",
    },
  });

  const wantedConversation = await api(
    `/market/items/${targetedItem.id}/conversations`,
    buyerToken,
    "POST",
    { wantedResponseId: wantedResponse.id },
  );
  const wantedOrder = await prisma.marketOrder.findUniqueOrThrow({
    where: { id: wantedConversation.orderId },
  });
  assert.equal(wantedOrder.status, "negotiating");
  assert.equal(wantedOrder.wantedPostId, wanted.id);
  assert.equal(wantedOrder.wantedResponseId, wantedResponse.id);
  assert.equal((await prisma.marketItem.findUniqueOrThrow({ where: { id: targetedItem.id } })).status, "targeted");
  assert.equal((await prisma.wantedPost.findUniqueOrThrow({ where: { id: wanted.id } })).status, "responded");
  assert.equal((await prisma.wantedResponse.findUniqueOrThrow({ where: { id: wantedResponse.id } })).status, "accepted");

  await Promise.all([
    api(`/market/orders/${wantedOrder.id}`, buyerToken, "PATCH", { action: "buyer_confirm" }),
    api(`/market/orders/${wantedOrder.id}`, responderToken, "PATCH", { action: "seller_confirm" }),
  ]);
  assert.equal((await prisma.marketOrder.findUniqueOrThrow({ where: { id: wantedOrder.id } })).status, "completed");
  assert.equal((await prisma.wantedPost.findUniqueOrThrow({ where: { id: wanted.id } })).status, "completed");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: responder.id } })).transactionPoints, 10);

  const privateTrust = await api("/market/trust/me", buyerToken);
  assert.equal(privateTrust.score, 100);
  assert.equal(privateTrust.physicalCompletedTradeCount, 2);
  assert.equal(privateTrust.physicalSellingItemCount, 0);
  assert.equal(privateTrust.physicalSoldItemCount, 0);
  assert.equal(privateTrust.completionRate, 0);
  assert.equal(privateTrust.positiveRate, 100);
  assert.equal(privateTrust.points.points, 20);

  const violation = await api("/market/admin/violations", adminToken, "POST", {
    userId: buyer.id,
    type: "reviewed_bad_behavior",
    level: "moderate",
    action: "warning",
    reason: `人工审核成立的违规 ${suffix}`,
  });
  violationIds.push(violation.id);
  assert.equal(violation.reputationDelta, -15);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).reputation, 85);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).transactionPoints, 20);

  const appeal = await api(`/market/violations/${violation.id}/appeals`, buyerToken, "POST", {
    content: "这是完整的申诉说明，包含可以由管理员复核的事实。",
  });
  await api(`/market/admin/appeals/${appeal.id}`, adminToken, "PATCH", {
    status: "approved",
    note: "复核后确认原处理有误",
  });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).reputation, 100);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).transactionPoints, 20);
});
