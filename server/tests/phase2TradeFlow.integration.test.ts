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
  const usernames = [`phase2_seller_${suffix}`, `phase2_buyer_${suffix}`];
  const users = await Promise.all(usernames.map((username, index) => prisma.user.create({
    data: { username, passwordHash: "not-used", nickname: index ? "阶段二买家" : "阶段二卖家", studentSso: true, forumEnabled: true, aiReviewWhitelisted: true, dataAuthAgreedAt: new Date() },
  })));
  const [seller, buyer] = users;
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

  async function api(path: string, token: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const body = await response.json() as { code: number; data: any; message: string };
    assert.equal(response.status, 200, `${method} ${path}: ${body.message}`);
    assert.equal(body.code, 0, `${method} ${path}: ${body.message}`);
    return body.data;
  }

  const listing = await api("/items", sellerToken, "POST", {
    listingType: "sell", title: `阶段二闭环商品 ${suffix}`, description: "真实接口闭环测试商品", category: "other", price: 88, negotiable: true, condition: "good", tradeMode: "meetup", campus: "SIP", location: "中心楼大厅", brand: "测试品牌", model: "T2", usageDuration: "半年", flaws: "轻微使用痕迹", accessories: "原包装", testAllowed: true, availableTime: "工作日 18:00 后", contactVisibility: "after_accept", expiryDays: 30, images: ["/uploads/phase2-test.jpg"],
  });
  assert.equal(listing.status, "active");
  assert.equal(listing.seller.username, undefined);

  const intent = await api(`/items/${listing.id}/intents`, buyerToken, "POST", { price: 80, message: "希望见面验货", availableTime: "周五 18:30" });
  assert.equal(intent.status, "pending");
  const reservation = await api(`/trade-intents/${intent.id}`, sellerToken, "PATCH", { action: "accept" });
  assert.equal(reservation.status, "reserved");
  assert.equal(reservation.platformFee, "0.00");
  assert.equal(reservation.payType, "");

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
  const review = await api(`/orders/${reservation.id}/reviews`, buyerToken, "POST", { rating: 5, content: "按约见面，描述准确" });
  assert.equal(review.rating, 5);

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

  const mine = await api("/mine", buyerToken);
  assert.ok(mine.orders.some((order: any) => order.id === reservation.id && order.status === "completed"));
  assert.ok(mine.wantedPosts.some((post: any) => post.id === wanted.id));
  assert.ok(mine.tradeIntents.some((row: any) => row.id === intent.id && row.status === "accepted"));
});
