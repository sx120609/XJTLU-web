import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-2-trade-flow-secret";

test("stage 2 real routes complete listing and wanted reservation flows without payment", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const usernames = [`phase2_seller_${suffix}`, `phase2_buyer_${suffix}`, `phase2_seller_2_${suffix}`];
  const users = await Promise.all(usernames.map((username, index) => prisma.user.create({
    data: { username, passwordHash: "not-used", nickname: ["阶段二卖家", "阶段二买家", "阶段二卖家二"][index], studentSso: true, forumEnabled: true, aiReviewWhitelisted: true, dataAuthAgreedAt: new Date() },
  })));
  const [seller, buyer, secondSeller] = users;
  const userIds = users.map((user) => user.id);
  const board = await prisma.board.findUnique({ where: { slug: "market" } });
  assert.ok(board, "market board must exist in the migrated baseline");

  t.after(async () => {
    const topicRows = await prisma.topic.findMany({ where: { authorId: { in: userIds } }, select: { id: true, boardId: true } });
    await prisma.marketConversation.deleteMany({ where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } });
    await prisma.marketOrder.deleteMany({ where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } });
    await prisma.tradeIntent.deleteMany({ where: { buyerId: { in: userIds } } });
    await prisma.wantedResponse.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.wantedPost.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.marketItem.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.topic.deleteMany({ where: { id: { in: topicRows.map((row) => row.id) } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const topicCountByBoard = new Map<number, number>();
    for (const row of topicRows) topicCountByBoard.set(row.boardId, (topicCountByBoard.get(row.boardId) || 0) + 1);
    for (const [boardId, count] of topicCountByBoard) {
      await prisma.board.update({ where: { id: boardId }, data: { topicCount: { decrement: count } } });
    }
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api/market`;
  const sellerToken = signToken({ userId: seller.id, studentId: seller.username, role: seller.role, campus: "SIP" });
  const buyerToken = signToken({ userId: buyer.id, studentId: buyer.username, role: buyer.role, campus: "SIP" });
  const secondSellerToken = signToken({ userId: secondSeller.id, studentId: secondSeller.username, role: secondSeller.role, campus: "SIP" });

  async function api(path: string, token: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const body = await response.json() as { code: number; data: any; message: string };
    assert.equal(response.status, 200, `${method} ${path}: ${body.message}`);
    assert.equal(body.code, 0, `${method} ${path}: ${body.message}`);
    return body.data;
  }

  const listing = await api("/items", sellerToken, "POST", {
    listingType: "sell", title: `阶段二闭环商品 ${suffix}`, description: "真实接口闭环测试商品", category: "other", price: 88, negotiable: true, condition: "good", tradeMode: "meetup", campus: "SIP", location: "中心楼大厅", brand: "测试品牌", model: "T2", usageDuration: "半年", flaws: "轻微使用痕迹", accessories: "原包装", testAllowed: true, availableTime: "工作日 18:00 后", contactVisibility: "after_accept", images: ["/uploads/phase2-test.jpg"],
  });
  assert.equal(listing.status, "active");
  assert.equal(listing.seller.username, undefined);
  const favoriteRace = await Promise.all([1, 2].map(() => fetch(
    `${baseUrl}/items/${listing.id}/favorite`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${buyerToken}` },
    },
  )));
  assert.ok(favoriteRace.every((response) => response.status === 200));
  assert.equal(await prisma.marketFavorite.count({
    where: { itemId: listing.id, userId: buyer.id },
  }), 0);
  assert.equal(
    (await prisma.marketItem.findUniqueOrThrow({ where: { id: listing.id } })).favoriteCount,
    0,
  );

  const intent = await api(`/items/${listing.id}/intents`, buyerToken, "POST", { price: 80, message: "希望见面验货", availableTime: "周五 18:30" });
  assert.equal(intent.status, "pending");
  const reservation = await api(`/trade-intents/${intent.id}`, sellerToken, "PATCH", { action: "accept" });
  assert.equal(reservation.status, "reserved");
  assert.equal(reservation.platformFee, "0.00");
  assert.equal(reservation.payType, "");
  const reservedEdit = await fetch(`${baseUrl}/items/${listing.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(reservedEdit.status, 409);
  const reservedDelete = await fetch(`${baseUrl}/items/${listing.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sellerToken}` },
  });
  assert.equal(reservedDelete.status, 409);
  assert.equal(
    (await prisma.marketItem.findUniqueOrThrow({ where: { id: listing.id } })).status,
    "reserved",
  );

  const meetup = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const scheduled = await api(`/orders/${reservation.id}`, buyerToken, "PATCH", { action: "set_meetup", meetupTime: meetup, meetupLocation: "中心楼大厅", note: "当面测试" });
  assert.equal(scheduled.status, "reserved");
  assert.equal(scheduled.meetupLocation, "中心楼大厅");
  const buyerConfirmed = await api(`/orders/${reservation.id}`, buyerToken, "PATCH", { action: "buyer_confirm" });
  assert.ok(buyerConfirmed.buyerConfirmedAt);
  assert.equal(buyerConfirmed.status, "reserved");
  const completed = await api(`/orders/${reservation.id}`, sellerToken, "PATCH", { action: "seller_confirm" });
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt);
  const reviewRace = await Promise.all([1, 2].map(() => fetch(
    `${baseUrl}/orders/${reservation.id}/reviews`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 5, content: "按约见面，描述准确" }),
    },
  )));
  assert.deepEqual(
    reviewRace.map((response) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const reviewSuccess = reviewRace.find((response) => response.status === 200);
  assert.ok(reviewSuccess);
  const reviewBody = await reviewSuccess.json() as { data: { rating: number } };
  assert.equal(reviewBody.data.rating, 5);
  assert.equal(await prisma.marketReview.count({
    where: { orderId: reservation.id, authorId: buyer.id },
  }), 1);
  const soldListing = await prisma.marketItem.findUniqueOrThrow({ where: { id: listing.id } });
  assert.equal(soldListing.status, "sold");
  assert.ok(soldListing.soldAt);
  const relisted = await api(`/items/${listing.id}/lifecycle`, sellerToken, "POST", { action: "relist" });
  assert.equal(relisted.status, "active");
  assert.equal(relisted.soldAt, null);
  const completedOrderAfterRelist = await prisma.marketOrder.findUniqueOrThrow({ where: { id: reservation.id } });
  assert.equal(completedOrderAfterRelist.status, "completed");
  await api(`/items/${listing.id}/lifecycle`, sellerToken, "POST", { action: "mark_sold" });
  const republishedFromEdit = await api(`/items/${listing.id}`, sellerToken, "PATCH", { status: "active" });
  assert.equal(republishedFromEdit.status, "active");
  assert.equal(republishedFromEdit.soldAt, null);

  const orderRaceListing = await api("/items", sellerToken, "POST", {
    listingType: "sell",
    title: `阶段二订单竞态商品 ${suffix}`,
    description: "验证确认完成与取消预约不能互相覆盖",
    category: "other",
    price: 66,
    negotiable: false,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "中心楼大厅",
    availableTime: "工作日晚上",
    contactVisibility: "after_accept",
    images: ["/uploads/phase2-order-race.jpg"],
  });
  const orderRaceIntent = await api(
    `/items/${orderRaceListing.id}/intents`,
    buyerToken,
    "POST",
    { price: 66, message: "订单竞态测试", availableTime: "周五晚上" },
  );
  const orderRaceReservation = await api(
    `/trade-intents/${orderRaceIntent.id}`,
    sellerToken,
    "PATCH",
    { action: "accept" },
  );
  await api(
    `/orders/${orderRaceReservation.id}`,
    buyerToken,
    "PATCH",
    { action: "buyer_confirm" },
  );
  const completionCancellationRace = await Promise.all([
    fetch(`${baseUrl}/orders/${orderRaceReservation.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seller_confirm" }),
    }),
    fetch(`${baseUrl}/orders/${orderRaceReservation.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", reason: "并发取消测试" }),
    }),
  ]);
  assert.deepEqual(
    completionCancellationRace.map((response) => response.status).sort((a, b) => a - b),
    [200, 400],
  );
  const [orderRaceState, orderRaceItemState] = await Promise.all([
    prisma.marketOrder.findUniqueOrThrow({ where: { id: orderRaceReservation.id } }),
    prisma.marketItem.findUniqueOrThrow({ where: { id: orderRaceListing.id } }),
  ]);
  assert.ok(["completed", "cancelled"].includes(orderRaceState.status));
  assert.equal(
    orderRaceItemState.status,
    orderRaceState.status === "completed" ? "sold" : "active",
  );

  const refundListing = await api("/items", sellerToken, "POST", {
    listingType: "sell",
    title: `阶段二退款竞态商品 ${suffix}`,
    description: "验证同一历史订单不能并发创建两个退款申请",
    category: "other",
    price: 54,
    negotiable: false,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "中心楼大厅",
    availableTime: "工作日晚上",
    contactVisibility: "after_accept",
    images: ["/uploads/phase2-refund-race.jpg"],
  });
  await prisma.marketItem.update({
    where: { id: refundListing.id },
    data: { status: "reserved" },
  });
  const refundOrder = await prisma.marketOrder.create({
    data: {
      itemId: refundListing.id,
      buyerId: buyer.id,
      sellerId: seller.id,
      outTradeNo: `MKREFUND${suffix}`,
      amountCents: 5400,
      platformFeeCents: 0,
      sellerAmountCents: 5400,
      deliveryType: "physical",
      status: "paid",
      paidAt: new Date(),
    },
  });
  const duplicateRefundRace = await Promise.all([1, 2].map(() => fetch(
    `${baseUrl}/orders/${refundOrder.id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request_refund", reason: "并发退款申请" }),
    },
  )));
  assert.deepEqual(
    duplicateRefundRace.map((response) => response.status).sort((a, b) => a - b),
    [200, 400],
  );
  assert.equal(await prisma.marketRefund.count({
    where: { orderId: refundOrder.id, status: "pending" },
  }), 1);
  assert.equal(
    (await prisma.marketOrder.findUniqueOrThrow({ where: { id: refundOrder.id } })).status,
    "refund_pending",
  );

  const competingListing = await api("/items", sellerToken, "POST", {
    listingType: "sell",
    title: `阶段二并发商品 ${suffix}`,
    description: "验证购买意向与旧报价不会同时成交",
    category: "other",
    price: 96,
    negotiable: true,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "中心楼大厅",
    brand: "测试品牌",
    model: "C2",
    usageDuration: "三个月",
    flaws: "轻微使用痕迹",
    accessories: "包装",
    testAllowed: true,
    availableTime: "工作日晚上",
    contactVisibility: "after_accept",
    images: ["/uploads/phase2-competing.jpg"],
  });
  const duplicateIntentPayload = {
    price: 90,
    message: "并发重复购买意向",
    availableTime: "周五晚上",
  };
  const duplicateIntentResponses = await Promise.all([1, 2].map(() => fetch(
    `${baseUrl}/items/${competingListing.id}/intents`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(duplicateIntentPayload),
    },
  )));
  assert.deepEqual(
    duplicateIntentResponses.map((response) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const duplicateIntentBodies = await Promise.all(
    duplicateIntentResponses.map((response) => response.json() as Promise<{ data: any }>),
  );
  const competingIntent = duplicateIntentBodies[
    duplicateIntentResponses.findIndex((response) => response.status === 200)
  ].data;
  assert.ok(competingIntent?.id);
  assert.equal(await prisma.tradeIntent.count({
    where: {
      itemId: competingListing.id,
      buyerId: buyer.id,
      status: "pending",
    },
  }), 1);
  const competingOffer = await api(
    `/items/${competingListing.id}/offers`,
    secondSellerToken,
    "POST",
    { price: 91, message: "旧客户端报价入口" },
  );
  const competingAcceptanceResponses = await Promise.all([
    fetch(`${baseUrl}/trade-intents/${competingIntent.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    }),
    fetch(`${baseUrl}/offers/${competingOffer.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    }),
  ]);
  assert.deepEqual(
    competingAcceptanceResponses.map((response) => response.status).sort((a, b) => a - b),
    [200, 400],
  );
  assert.equal(await prisma.marketOrder.count({
    where: { itemId: competingListing.id },
  }), 1);
  const [competingIntentState, competingOfferState, competingItemState] = await Promise.all([
    prisma.tradeIntent.findUniqueOrThrow({ where: { id: competingIntent.id } }),
    prisma.marketOffer.findUniqueOrThrow({ where: { id: competingOffer.id } }),
    prisma.marketItem.findUniqueOrThrow({ where: { id: competingListing.id } }),
  ]);
  assert.deepEqual(
    [competingIntentState.status, competingOfferState.status].sort(),
    ["accepted", "rejected"],
  );
  assert.equal(competingItemState.status, "reserved");

  const writeRaceListing = await api("/items", sellerToken, "POST", {
    listingType: "sell",
    title: `阶段二商品写入竞态 ${suffix}`,
    description: "验证编辑下架与接受购买意向不能留下半完成状态",
    category: "other",
    price: 72,
    negotiable: false,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "中心楼大厅",
    availableTime: "工作日晚上",
    contactVisibility: "after_accept",
    images: ["/uploads/phase2-item-write-race.jpg"],
  });
  const writeRaceIntent = await api(
    `/items/${writeRaceListing.id}/intents`,
    buyerToken,
    "POST",
    { price: 72, message: "商品写入竞态测试", availableTime: "周五晚上" },
  );
  const itemWriteRace = await Promise.all([
    fetch(`${baseUrl}/trade-intents/${writeRaceIntent.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    }),
    fetch(`${baseUrl}/items/${writeRaceListing.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "draft" }),
    }),
  ]);
  const itemWriteRaceStatuses = itemWriteRace
    .map((response) => response.status)
    .sort((a, b) => a - b);
  assert.equal(itemWriteRaceStatuses[0], 200);
  assert.ok([400, 409].includes(itemWriteRaceStatuses[1]));
  const [writeRaceItemState, writeRaceIntentState, writeRaceOrders] = await Promise.all([
    prisma.marketItem.findUniqueOrThrow({ where: { id: writeRaceListing.id } }),
    prisma.tradeIntent.findUniqueOrThrow({ where: { id: writeRaceIntent.id } }),
    prisma.marketOrder.findMany({ where: { itemId: writeRaceListing.id } }),
  ]);
  if (writeRaceOrders.length) {
    assert.equal(writeRaceOrders.length, 1);
    assert.equal(writeRaceItemState.status, "reserved");
    assert.equal(writeRaceIntentState.status, "accepted");
  } else {
    assert.equal(writeRaceItemState.status, "draft");
    assert.equal(writeRaceIntentState.status, "expired");
  }

  const wanted = await api("/wanted", buyerToken, "POST", { title: `阶段二求购 ${suffix}`, category: "other", budgetMin: 40, budgetMax: 120, brandModel: "不限", condition: "使用良好", expectedTradeTime: "本周内", campus: "SIP", location: "中心楼大厅", description: "希望现场测试功能", allowSellerOffers: true, expiryDays: 21 });
  assert.equal(wanted.status, "active");
  const wantedResponse = await api(`/wanted/${wanted.id}/responses`, sellerToken, "POST", { title: `定向响应商品 ${suffix}`, price: 70, description: "功能正常，有轻微使用痕迹", images: ["/uploads/phase2-targeted.jpg"], condition: "good", brand: "测试品牌", model: "W2", availableTime: "周六下午" });
  assert.equal(wantedResponse.status, "pending");
  assert.equal(wantedResponse.item.visibility, "targeted");
  const wantedReservation = await api(`/wanted-responses/${wantedResponse.id}`, buyerToken, "PATCH", { action: "accept" });
  assert.equal(wantedReservation.status, "reserved");
  assert.equal(wantedReservation.wantedPostId, wanted.id);
  const cancelled = await api(`/orders/${wantedReservation.id}`, sellerToken, "PATCH", { action: "cancel", reason: "双方时间无法协调" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelReason, "双方时间无法协调");
  const reopenedWanted = await prisma.wantedPost.findUniqueOrThrow({ where: { id: wanted.id } });
  assert.equal(reopenedWanted.status, "responded");

  const concurrentWanted = await api("/wanted", buyerToken, "POST", {
    title: `阶段二并发求购 ${suffix}`,
    category: "other",
    budgetMin: 40,
    budgetMax: 120,
    brandModel: "不限",
    condition: "使用良好",
    expectedTradeTime: "本周内",
    campus: "SIP",
    location: "中心楼大厅",
    description: "验证同一求购只能接受一个响应",
    allowSellerOffers: true,
    expiryDays: 21,
  });
  const [firstResponse, secondResponse] = await Promise.all([
    api(`/wanted/${concurrentWanted.id}/responses`, sellerToken, "POST", {
      title: `并发响应商品一 ${suffix}`,
      price: 75,
      description: "第一件响应商品",
      images: ["/uploads/phase2-concurrent-1.jpg"],
      condition: "good",
      availableTime: "周六下午",
    }),
    api(`/wanted/${concurrentWanted.id}/responses`, secondSellerToken, "POST", {
      title: `并发响应商品二 ${suffix}`,
      price: 78,
      description: "第二件响应商品",
      images: ["/uploads/phase2-concurrent-2.jpg"],
      condition: "good",
      availableTime: "周日下午",
    }),
  ]);
  const acceptanceResponses = await Promise.all([
    fetch(`${baseUrl}/wanted-responses/${firstResponse.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    }),
    fetch(`${baseUrl}/wanted-responses/${secondResponse.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    }),
  ]);
  assert.deepEqual(acceptanceResponses.map((response) => response.status).sort((a, b) => a - b), [200, 400]);
  const concurrentOrders = await prisma.marketOrder.findMany({
    where: { wantedPostId: concurrentWanted.id },
  });
  assert.equal(concurrentOrders.length, 1);
  const matchedConcurrentWanted = await prisma.wantedPost.findUniqueOrThrow({
    where: { id: concurrentWanted.id },
  });
  assert.equal(matchedConcurrentWanted.status, "matched");
  const concurrentResponseStates = await prisma.wantedResponse.findMany({
    where: { wantedPostId: concurrentWanted.id },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(
    concurrentResponseStates.map((response) => response.status).sort(),
    ["accepted", "rejected"],
  );

  const duplicateWanted = await api("/wanted", buyerToken, "POST", {
    title: `阶段二重复响应求购 ${suffix}`,
    category: "other",
    budgetMin: 30,
    budgetMax: 100,
    brandModel: "不限",
    condition: "使用良好",
    expectedTradeTime: "下周内",
    campus: "SIP",
    location: "中心楼大厅",
    description: "验证同一卖家不能并发提交两个待处理响应",
    allowSellerOffers: true,
    expiryDays: 21,
  });
  const duplicatePayload = {
    title: `重复响应商品 ${suffix}`,
    price: 65,
    description: "并发重复响应测试商品",
    images: ["/uploads/phase2-duplicate.jpg"],
    condition: "good",
    availableTime: "工作日晚上",
  };
  const duplicateResponses = await Promise.all([1, 2].map(() => fetch(
    `${baseUrl}/wanted/${duplicateWanted.id}/responses`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(duplicatePayload),
    },
  )));
  assert.deepEqual(duplicateResponses.map((response) => response.status).sort((a, b) => a - b), [200, 409]);
  assert.equal(await prisma.wantedResponse.count({
    where: { wantedPostId: duplicateWanted.id, sellerId: seller.id, status: "pending" },
  }), 1);

  const mine = await api("/mine", buyerToken);
  assert.ok(mine.orders.some((order: any) => order.id === reservation.id && order.status === "completed"));
  assert.ok(mine.wantedPosts.some((post: any) => post.id === wanted.id));
  assert.ok(mine.tradeIntents.some((row: any) => row.id === intent.id && row.status === "accepted"));
});
