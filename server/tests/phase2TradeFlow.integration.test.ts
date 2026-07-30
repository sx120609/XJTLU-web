import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-2-direct-trade-secret";

test("stage 2 real routes complete direct-chat and wanted-response trades without reservations", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const users = await Promise.all(["seller", "buyer", "seller2"].map((label) => (
    prisma.user.create({
      data: {
        username: `phase2_${label}_${suffix}`,
        passwordHash: "not-used",
        nickname: `Phase 2 ${label} ${suffix}`,
        studentSso: true,
        forumEnabled: true,
        aiReviewWhitelisted: true,
        dataAuthAgreedAt: new Date(),
      },
    })
  )));
  const [seller, buyer, secondSeller] = users;
  const userIds = users.map((user) => user.id);

  t.after(async () => {
    const topicRows = await prisma.topic.findMany({
      where: { authorId: { in: userIds } },
      select: { id: true, boardId: true },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.transactionPointEntry.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketReview.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.marketFavorite.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketConversation.deleteMany({
      where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
    });
    await prisma.marketOrder.deleteMany({
      where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
    });
    await prisma.tradeIntent.deleteMany({ where: { buyerId: { in: userIds } } });
    await prisma.marketOffer.deleteMany({ where: { buyerId: { in: userIds } } });
    await prisma.wantedResponse.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.wantedPost.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.marketItem.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.topic.deleteMany({ where: { id: { in: topicRows.map((row) => row.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    const topicCountByBoard = new Map<number, number>();
    for (const row of topicRows) {
      topicCountByBoard.set(row.boardId, (topicCountByBoard.get(row.boardId) || 0) + 1);
    }
    for (const [boardId, count] of topicCountByBoard) {
      await prisma.board.update({
        where: { id: boardId },
        data: { topicCount: { decrement: count } },
      });
    }
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/market`;
  const token = (user: typeof seller) => signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });
  const sellerToken = token(seller);
  const buyerToken = token(buyer);
  const secondSellerToken = token(secondSeller);

  async function call(path: string, bearer: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await response.json() as { code: number; data: any; message: string };
    return { response, body };
  }

  async function api(path: string, bearer: string, method = "GET", payload?: unknown) {
    const result = await call(path, bearer, method, payload);
    assert.equal(result.response.status, 200, `${method} ${path}: ${result.body.message}`);
    assert.equal(result.body.code, 0, `${method} ${path}: ${result.body.message}`);
    return result.body.data;
  }

  const listingPayload = (title: string, price: number) => ({
    listingType: "sell",
    title,
    description: "A physical listing used to verify the direct private-chat trade lifecycle.",
    category: "other",
    price,
    negotiable: true,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "Central Building",
    brand: "Test",
    model: "V1",
    usageDuration: "six months",
    flaws: "minor signs of use",
    accessories: "original packaging",
    testAllowed: true,
    availableTime: "weekday evenings",
    images: ["/uploads/phase2-direct-trade.jpg"],
  });

  const listing = await api(
    "/items",
    sellerToken,
    "POST",
    listingPayload(`Direct chat listing ${suffix}`, 88),
  );
  assert.equal(listing.status, "active");
  assert.equal(listing.seller.username, undefined);

  const favoriteRace = await Promise.all([1, 2].map(() => (
    call(`/items/${listing.id}/favorite`, buyerToken, "POST")
  )));
  assert.ok(favoriteRace.every((result) => result.response.status === 200));
  assert.equal(await prisma.marketFavorite.count({
    where: { itemId: listing.id, userId: buyer.id },
  }), 0);

  const conversations = await Promise.all([
    api(`/items/${listing.id}/conversations`, buyerToken, "POST", {
      message: "Hi, is this still available?",
    }),
    api(`/items/${listing.id}/conversations`, buyerToken, "POST", {}),
  ]);
  assert.equal(conversations[0].id, conversations[1].id);
  assert.equal(conversations[0].orderId, conversations[1].orderId);
  const order = await prisma.marketOrder.findUniqueOrThrow({
    where: { id: conversations[0].orderId },
  });
  assert.equal(order.status, "negotiating");
  assert.equal(order.tradeIntentId, null);
  assert.equal(order.offerId, null);
  assert.equal((await prisma.marketItem.findUniqueOrThrow({
    where: { id: listing.id },
  })).status, "active");

  const confirmations = await Promise.all([
    api(`/orders/${order.id}`, buyerToken, "PATCH", { action: "buyer_confirm" }),
    api(`/orders/${order.id}`, sellerToken, "PATCH", { action: "seller_confirm" }),
  ]);
  assert.ok(confirmations.some((entry) => entry.status === "completed"));
  assert.equal((await prisma.marketOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "completed");
  assert.equal((await prisma.marketItem.findUniqueOrThrow({ where: { id: listing.id } })).status, "sold");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).transactionPoints, 10);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).transactionPoints, 10);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: seller.id } })).reputation, 100);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).reputation, 100);

  const reviewRace = await Promise.all([1, 2].map(() => (
    call(`/orders/${order.id}/reviews`, buyerToken, "POST", {
      rating: 5,
      content: "The item matched the description and the trade went smoothly.",
    })
  )));
  assert.deepEqual(
    reviewRace.map((result) => result.response.status).sort((a, b) => a - b),
    [200, 409],
  );
  assert.equal(await prisma.marketReview.count({
    where: { orderId: order.id, authorId: buyer.id },
  }), 1);

  const relisted = await api(`/items/${listing.id}/lifecycle`, sellerToken, "POST", {
    action: "relist",
  });
  assert.equal(relisted.status, "active");
  assert.equal((await prisma.marketOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "completed");

  const raceListing = await api(
    "/items",
    sellerToken,
    "POST",
    listingPayload(`Confirm cancel race ${suffix}`, 66),
  );
  const raceConversation = await api(
    `/items/${raceListing.id}/conversations`,
    buyerToken,
    "POST",
    { message: "Let's discuss this item." },
  );
  await api(`/orders/${raceConversation.orderId}`, buyerToken, "PATCH", {
    action: "buyer_confirm",
  });
  const completionCancellationRace = await Promise.all([
    call(`/orders/${raceConversation.orderId}`, sellerToken, "PATCH", {
      action: "seller_confirm",
    }),
    call(`/orders/${raceConversation.orderId}`, buyerToken, "PATCH", {
      action: "cancel",
      reason: "The parties could not agree on the handover time.",
    }),
  ]);
  assert.deepEqual(
    completionCancellationRace.map((result) => result.response.status).sort((a, b) => a - b),
    [200, 400],
  );
  const raceOrder = await prisma.marketOrder.findUniqueOrThrow({
    where: { id: raceConversation.orderId },
  });
  const raceItem = await prisma.marketItem.findUniqueOrThrow({
    where: { id: raceListing.id },
  });
  assert.ok(["completed", "cancelled"].includes(raceOrder.status));
  assert.equal(raceItem.status, raceOrder.status === "completed" ? "sold" : "active");

  const wanted = await api("/wanted", buyerToken, "POST", {
    title: `Direct wanted request ${suffix}`,
    category: "other",
    budgetMin: 40,
    budgetMax: 120,
    brandModel: "Any suitable model",
    condition: "good working condition",
    expectedTradeTime: "this week",
    campus: "SIP",
    location: "Central Building",
    description: "A wanted request used to verify direct chat with a targeted response.",
    allowSellerOffers: true,
    expiryDays: 21,
  });
  const wantedResponse = await api(
    `/wanted/${wanted.id}/responses`,
    secondSellerToken,
    "POST",
    {
      title: `Targeted response item ${suffix}`,
      price: 70,
      description: "The item works normally and can be inspected before the trade.",
      images: ["/uploads/phase2-targeted.jpg"],
      condition: "good",
      brand: "Test",
      model: "Wanted V1",
      availableTime: "Saturday afternoon",
    },
  );
  assert.equal(wantedResponse.status, "pending");
  assert.equal(wantedResponse.item.visibility, "targeted");

  const wantedConversation = await api(
    `/items/${wantedResponse.itemId}/conversations`,
    buyerToken,
    "POST",
    { wantedResponseId: wantedResponse.id, message: "Let's discuss your response." },
  );
  const wantedOrder = await prisma.marketOrder.findUniqueOrThrow({
    where: { id: wantedConversation.orderId },
  });
  assert.equal(wantedOrder.status, "negotiating");
  assert.equal(wantedOrder.wantedPostId, wanted.id);
  assert.equal(wantedOrder.wantedResponseId, wantedResponse.id);
  assert.equal((await prisma.wantedPost.findUniqueOrThrow({ where: { id: wanted.id } })).status, "responded");
  assert.equal((await prisma.wantedResponse.findUniqueOrThrow({
    where: { id: wantedResponse.id },
  })).status, "accepted");

  const cancelled = await api(`/orders/${wantedOrder.id}`, secondSellerToken, "PATCH", {
    action: "cancel",
    reason: "The parties could not agree on a handover time.",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await prisma.wantedPost.findUniqueOrThrow({ where: { id: wanted.id } })).status, "responded");
  assert.equal((await prisma.wantedResponse.findUniqueOrThrow({
    where: { id: wantedResponse.id },
  })).status, "cancelled");
  assert.equal((await prisma.marketItem.findUniqueOrThrow({
    where: { id: wantedResponse.itemId },
  })).status, "withdrawn");

  const mine = await api("/mine", buyerToken);
  assert.ok(mine.orders.some((entry: any) => entry.id === order.id && entry.status === "completed"));
  assert.ok(mine.orders.some((entry: any) => entry.id === wantedOrder.id && entry.status === "cancelled"));
  assert.ok(mine.wantedPosts.some((entry: any) => entry.id === wanted.id));
  assert.equal(await prisma.tradeIntent.count({ where: { buyerId: buyer.id } }), 0);
  assert.equal(await prisma.marketOffer.count({ where: { buyerId: buyer.id } }), 0);
});
