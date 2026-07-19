import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-3-market-trust-secret";

test("stage 3 real routes enforce post-accept privacy, trust restrictions, reports and appeals", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const roles = ["user", "user", "user", "admin"];
  const labels = ["卖家", "买家", "旁观者", "管理员"];
  const users = await Promise.all(roles.map((role, index) => prisma.user.create({
    data: {
      username: `phase3_${index}_${suffix}`,
      passwordHash: "not-used",
      nickname: `阶段三${labels[index]}_${suffix}`,
      role,
      studentSso: true,
      forumEnabled: true,
      aiReviewWhitelisted: true,
      dataAuthAgreedAt: new Date(),
    },
  })));
  const [seller, buyer, outsider, admin] = users;
  const userIds = users.map((user) => user.id);
  const reportIds: number[] = [];
  const appealIds: number[] = [];
  const violationIds: number[] = [];
  const board = await prisma.board.findUnique({ where: { slug: "market" } });
  assert.ok(board, "market board must exist");

  t.after(async () => {
    const topicRows = await prisma.topic.findMany({ where: { authorId: { in: userIds } }, select: { id: true, boardId: true, hidden: true } });
    const payloadMarkers = [...reportIds.map((id) => `\"reportId\":${id}`), ...appealIds.map((id) => `\"appealId\":${id}`), ...violationIds.map((id) => `\"violationId\":${id}`)];
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { content: { contains: suffix } }, ...payloadMarkers.map((marker) => ({ payload: { contains: marker } }))] } });
    await prisma.marketReport.deleteMany({ where: { OR: [{ reporterId: { in: userIds } }, { reportedUserId: { in: userIds } }] } });
    await prisma.marketAppeal.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketViolation.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { createdById: { in: userIds } }] } });
    await prisma.marketContactCard.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.marketConversation.deleteMany({ where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } });
    await prisma.marketOrder.deleteMany({ where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } });
    await prisma.tradeIntent.deleteMany({ where: { buyerId: { in: userIds } } });
    await prisma.wantedResponse.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.wantedPost.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.marketItem.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.topic.deleteMany({ where: { id: { in: topicRows.map((row) => row.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const countByBoard = new Map<number, number>();
    for (const row of topicRows.filter((topic) => !topic.hidden)) countByBoard.set(row.boardId, (countByBoard.get(row.boardId) || 0) + 1);
    for (const [boardId, count] of countByBoard) await prisma.board.update({ where: { id: boardId }, data: { topicCount: { decrement: count } } });
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
  const token = (user: typeof seller) => signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "SIP" });
  const sellerToken = token(seller);
  const buyerToken = token(buyer);
  const outsiderToken = token(outsider);
  const adminToken = token(admin);

  async function call(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
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

  const sellerContact = "seller_wechat_phase3";
  const buyerContact = "13812345678";
  const sellerCard = await api("/contact-card", sellerToken, "PATCH", { method: "wechat", value: sellerContact });
  const buyerCard = await api("/contact-card", buyerToken, "PATCH", { method: "phone", value: buyerContact });
  assert.equal(sellerCard.valueMasked, "se***e3");
  assert.equal(buyerCard.valueMasked, "138****5678");
  const encryptedContact = await prisma.marketContactCard.findUniqueOrThrow({ where: { userId: seller.id } });
  assert.notEqual(encryptedContact.valueEncrypted, sellerContact);

  const listingPayload = (title: string) => ({ listingType: "sell", title, description: "阶段三真实接口安全交易测试", category: "other", price: 88, negotiable: true, condition: "good", tradeMode: "meetup", campus: "SIP", location: "中心楼大厅", brand: "测试品牌", model: "T3", usageDuration: "半年", flaws: "轻微使用痕迹", accessories: "原包装", testAllowed: true, availableTime: "工作日 18:00 后", contactVisibility: "after_accept", expiryDays: 30, images: ["/uploads/phase3-test.jpg"] });
  const listing = await api("/items", sellerToken, "POST", listingPayload(`阶段三隐私商品 ${suffix}`));
  assert.equal(listing.status, "active");
  assert.equal(listing.seller.username, undefined);

  const earlyConversation = await call(`/items/${listing.id}/conversations`, buyerToken, "POST", { message: "提前联系" });
  assert.equal(earlyConversation.response.status, 403);
  assert.match(earlyConversation.body.message, /接受购买意向后/);
  const intent = await api(`/items/${listing.id}/intents`, buyerToken, "POST", { price: 80, message: "希望当面测试", availableTime: "周五 18:30" });
  assert.equal(intent.conversationId, null);
  assert.equal(await prisma.marketConversation.count({ where: { itemId: listing.id, buyerId: buyer.id } }), 0);

  const reservation = await api(`/trade-intents/${intent.id}`, sellerToken, "PATCH", { action: "accept" });
  assert.equal(reservation.status, "reserved");
  const linkedConversation = await prisma.marketConversation.findFirst({ where: { itemId: listing.id, buyerId: buyer.id } });
  assert.equal(linkedConversation?.orderId, reservation.id);
  const contacts = await api(`/orders/${reservation.id}/contact-cards`, buyerToken);
  assert.equal(contacts.counterpart.contact.value, sellerContact);
  assert.equal(contacts.own.contact.value, buyerContact);
  const outsiderContacts = await call(`/orders/${reservation.id}/contact-cards`, outsiderToken);
  assert.equal(outsiderContacts.response.status, 404);
  const publicListing = await api(`/items/${listing.id}`);
  assert.equal(JSON.stringify(publicListing).includes(sellerContact), false);
  assert.equal(JSON.stringify(publicListing).includes(buyerContact), false);

  const blockedListing = await call("/items", sellerToken, "POST", listingPayload(`出售处方药 ${suffix}`));
  assert.equal(blockedListing.response.status, 400);
  assert.match(blockedListing.body.message, /禁售|高风险/);
  const reviewListing = await api("/items", sellerToken, "POST", listingPayload(`微信联系测试 ${suffix}`));
  assert.equal(reviewListing.status, "reviewing");

  const secondListing = await api("/items", sellerToken, "POST", listingPayload(`阶段三限制测试商品 ${suffix}`));
  const violation = await api("/admin/violations", adminToken, "POST", { userId: buyer.id, type: "risk_trade", level: "moderate", action: "restrict_trade", reason: `阶段三限制测试 ${suffix}`, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
  violationIds.push(violation.id);
  const restrictedIntent = await call(`/items/${secondListing.id}/intents`, buyerToken, "POST", { price: 80, message: "限制期间测试", availableTime: "周六下午" });
  assert.equal(restrictedIntent.response.status, 403);
  assert.match(restrictedIntent.body.message, /交易功能已受限/);
  const myTrust = await api("/trust/me", buyerToken);
  assert.equal(myTrust.identity.verified, true);
  assert.ok(myTrust.restrictions.some((entry: any) => entry.id === violation.id));
  const appeal = await api(`/violations/${violation.id}/appeals`, buyerToken, "POST", { content: "这是阶段三自动化测试申诉，包含可核验的完整说明。" });
  appealIds.push(appeal.id);
  const handledAppeal = await api(`/admin/appeals/${appeal.id}`, adminToken, "PATCH", { status: "approved", note: "自动化核验通过，撤销限制" });
  assert.equal(handledAppeal.status, "approved");
  const restoredIntent = await api(`/items/${secondListing.id}/intents`, buyerToken, "POST", { price: 80, message: "撤销后恢复", availableTime: "周六下午" });
  assert.equal(restoredIntent.status, "pending");

  const userReport = await api(`/users/${seller.id}/reports`, outsiderToken, "POST", { reason: "阶段三用户举报", detail: suffix });
  reportIds.push(userReport.id);
  const orderReport = await api(`/orders/${reservation.id}/report`, buyerToken, "POST", { reason: "阶段三交易举报", detail: suffix });
  reportIds.push(orderReport.id);
  const wanted = await api("/wanted", buyerToken, "POST", { title: `阶段三求购 ${suffix}`, category: "other", budgetMin: 20, budgetMax: 100, brandModel: "不限", condition: "使用良好", expectedTradeTime: "本周", campus: "SIP", location: "中心楼大厅", description: "阶段三求购举报测试", allowSellerOffers: true, expiryDays: 21 });
  const wantedReport = await api(`/wanted/${wanted.id}/reports`, outsiderToken, "POST", { reason: "阶段三求购举报", detail: suffix });
  reportIds.push(wantedReport.id);
  const overview = await api("/admin/overview", adminToken);
  assert.ok(["user", "trade", "wanted"].every((type) => overview.reports.some((report: any) => report.type === type && reportIds.includes(report.id))));
  const logs = await api("/admin/action-logs?size=100", adminToken);
  assert.ok(logs.list.some((entry: any) => entry.action === "market.violation.create" && entry.targetId === String(buyer.id)));
  assert.ok(logs.list.some((entry: any) => entry.action === "market.appeal.approved" && entry.targetId === String(appeal.id)));
  assert.equal(JSON.stringify(logs.list).includes(sellerContact), false);
});
