import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-3-market-trust-secret";

test("stage 3 real routes enforce direct-chat privacy, trust restrictions, reports and appeals", async (t) => {
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
      postCount: index === 1 ? 6 : 0,
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
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.marketConversation.deleteMany({ where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] } });
    await prisma.forumImageAsset.deleteMany({ where: { createdById: { in: userIds }, url: { contains: suffix } } });
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
      headers: { "Accept-Language": "zh-CN", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const rawBody = await response.text();
    let body: { code: number; data: any; message: string };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      body = { code: response.status, data: null, message: rawBody };
    }
    return { response, body };
  }

  async function api(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const result = await call(path, bearer, method, payload);
    assert.equal(result.response.status, 200, `${method} ${path}: ${result.body.message}`);
    assert.equal(result.body.code, 0, `${method} ${path}: ${result.body.message}`);
    return result.body.data;
  }

  const removedContactWrite = await call("/contact-card", sellerToken, "PATCH", {
    method: "wechat",
    value: "legacy_contact_must_not_be_saved",
  });
  assert.equal(removedContactWrite.response.status, 404);

  const listingPayload = (title: string) => ({ listingType: "sell", title, description: "阶段三真实接口安全交易测试", category: "other", price: 88, negotiable: true, condition: "good", tradeMode: "meetup", campus: "SIP", location: "中心楼大厅", brand: "测试品牌", model: "T3", usageDuration: "半年", flaws: "轻微使用痕迹", accessories: "原包装", testAllowed: true, availableTime: "工作日 18:00 后", images: ["/uploads/phase3-test.jpg"] });
  const listing = await api("/items", sellerToken, "POST", listingPayload(`阶段三隐私商品 ${suffix}`));
  assert.equal(listing.status, "active");
  assert.equal(listing.seller.username, undefined);

  const earlyConversation = await api(
    `/items/${listing.id}/conversations`,
    buyerToken,
    "POST",
    { message: "提前联系并直接协商" },
  );
  assert.ok(earlyConversation.orderId);
  assert.equal(
    await prisma.marketConversation.count({ where: { itemId: listing.id, buyerId: buyer.id } }),
    1,
  );
  const reservation = await prisma.marketOrder.findUniqueOrThrow({
    where: { id: earlyConversation.orderId },
  });
  assert.equal(reservation.status, "negotiating");
  assert.equal(reservation.tradeIntentId, null);
  const linkedConversation = await prisma.marketConversation.findFirst({ where: { itemId: listing.id, buyerId: buyer.id } });
  assert.equal(linkedConversation?.orderId, reservation.id);

  await prisma.user.update({ where: { id: buyer.id }, data: { status: "muted", mutedUntil: new Date(Date.now() + 60_000) } });
  const mutedInitialMessage = await call(`/items/${listing.id}/conversations`, buyerToken, "POST", { message: "禁言期间不能发送" });
  assert.equal(mutedInitialMessage.response.status, 403);
  assert.match(mutedInitialMessage.body.message, /禁言/);
  await prisma.user.update({ where: { id: buyer.id }, data: { status: "active", mutedUntil: null } });

  const conversationList = await api("/conversations", buyerToken);
  const conversationSummary = conversationList.find((entry: any) => entry.id === linkedConversation?.id);
  assert.ok(conversationSummary);
  assert.equal(conversationSummary.item.description, undefined);
  assert.equal(conversationSummary.item.digitalDeliveryEncrypted, undefined);
  assert.equal(conversationSummary.counterpart.id, seller.id);
  assert.equal(conversationSummary.counterpart.username, undefined);

  const sentMessage = await api(`/conversations/${linkedConversation!.id}/messages`, buyerToken, "POST", {
    content: "周五见面前再确认一次",
    clientMessageId: `phase3-message-${suffix}`,
  });
  assert.equal(sentMessage.content, "周五见面前再确认一次");
  assert.equal(sentMessage.sender.id, buyer.id);
  assert.equal(sentMessage.sender.username, undefined);
  const retriedMessage = await api(`/conversations/${linkedConversation!.id}/messages`, buyerToken, "POST", {
    content: "周五见面前再确认一次",
    clientMessageId: `phase3-message-${suffix}`,
  });
  assert.equal(retriedMessage.id, sentMessage.id);
  const sellerUnread = await api("/conversations?filter=unread", sellerToken);
  const sellerUnreadConversation = sellerUnread.find((entry: any) => entry.id === linkedConversation!.id);
  assert.ok(sellerUnreadConversation);
  assert.equal(sellerUnreadConversation.unreadCount, 2);
  const sellerUnreadSummary = await api("/conversations/unread-count", sellerToken);
  assert.equal(sellerUnreadSummary.unreadCount, 2);
  assert.equal(sellerUnreadSummary.conversationCount, 1);
  const searchedConversation = await api(`/conversations?q=${encodeURIComponent(listing.title)}`, sellerToken);
  assert.equal(searchedConversation.some((entry: any) => entry.id === linkedConversation!.id), true);
  const messageReport = await api(
    `/conversations/${linkedConversation!.id}/messages/${sentMessage.id}/report`,
    sellerToken,
    "POST",
    { reason: "测试消息举报", detail: suffix },
  );
  reportIds.push(messageReport.id);
  assert.equal(messageReport.messageId, sentMessage.id);
  const blocked = await api(`/conversations/${linkedConversation!.id}/block`, sellerToken, "POST");
  assert.equal(blocked.blocked, true);
  const blockedSend = await call(
    `/conversations/${linkedConversation!.id}/messages`,
    buyerToken,
    "POST",
    { content: "屏蔽期间不应送达", clientMessageId: `blocked-${suffix}` },
  );
  assert.equal(blockedSend.response.status, 403);
  const unblocked = await api(`/conversations/${linkedConversation!.id}/block`, sellerToken, "POST");
  assert.equal(unblocked.blocked, false);
  const chatImageUrl = `/uploads/chat-${suffix}.webp`;
  await prisma.forumImageAsset.create({
    data: {
      url: chatImageUrl,
      localPath: `chat-${suffix}.webp`,
      mimeType: "image/webp",
      status: "approved",
      createdById: buyer.id,
    },
  });
  const imageMessage = await api(
    `/conversations/${linkedConversation!.id}/messages`,
    buyerToken,
    "POST",
    {
      clientMessageId: `image-${suffix}`,
      attachments: [{ url: chatImageUrl, mimeType: "image/webp" }],
    },
  );
  assert.equal(imageMessage.kind, "image");
  assert.equal(imageMessage.attachments[0].url, chatImageUrl);
  await prisma.marketMessage.createMany({
    data: Array.from({ length: 305 }, (_, index) => ({
      conversationId: linkedConversation!.id,
      senderId: buyer.id,
      content: `历史分页消息 ${index}`,
    })),
  });
  const pagedMessages = await api(`/conversations/${linkedConversation!.id}/messages`, sellerToken);
  assert.equal(pagedMessages.list.length, 50);
  assert.equal(pagedMessages.list[0].content, "历史分页消息 255");
  assert.equal(pagedMessages.list.at(-1).content, "历史分页消息 304");
  assert.ok(pagedMessages.nextCursor);
  assert.ok(pagedMessages.list.every((message: any, index: number) => index === 0 || message.id > pagedMessages.list[index - 1].id));
  const persistedMessages = await prisma.marketMessage.findMany({
    where: { conversationId: linkedConversation!.id },
    select: { id: true, readAt: true },
    orderBy: { id: "asc" },
  });
  assert.equal(persistedMessages.length, 308);
  assert.equal(persistedMessages[0].readAt, null);
  assert.ok(persistedMessages.at(-1)?.readAt);
  const unreadBeforeExplicitRead = await api("/conversations/unread-count", sellerToken);
  assert.ok(unreadBeforeExplicitRead.unreadCount > 0);
  await api(`/conversations/${linkedConversation!.id}/read`, sellerToken, "POST");
  const unreadAfterExplicitRead = await api("/conversations/unread-count", sellerToken);
  assert.equal(unreadAfterExplicitRead.unreadCount, 0);
  assert.equal(unreadAfterExplicitRead.conversationCount, 0);

  const contacts = await call(`/orders/${reservation.id}/contact-cards`, buyerToken);
  assert.equal(contacts.response.status, 404);
  const outsiderContacts = await call(`/orders/${reservation.id}/contact-cards`, outsiderToken);
  assert.equal(outsiderContacts.response.status, 404);
  const publicListing = await api(`/items/${listing.id}`);
  assert.equal(JSON.stringify(publicListing).includes("contactVisibility"), false);

  const blockedListing = await call("/items", sellerToken, "POST", listingPayload(`出售处方药 ${suffix}`));
  assert.equal(blockedListing.response.status, 400);
  assert.match(blockedListing.body.message, /禁售|高风险/);
  const reviewListing = await api("/items", sellerToken, "POST", listingPayload(`微信联系测试 ${suffix}`));
  assert.equal(reviewListing.status, "reviewing");

  const secondListing = await api("/items", sellerToken, "POST", listingPayload(`阶段三限制测试商品 ${suffix}`));
  const mismatchedViolation = await call("/admin/violations", adminToken, "POST", {
    userId: buyer.id,
    itemId: secondListing.id,
    type: "risk_trade",
    level: "moderate",
    action: "restrict_trade",
    reason: `阶段三错误关联测试 ${suffix}`,
  });
  assert.equal(mismatchedViolation.response.status, 400);
  assert.match(mismatchedViolation.body.message, /不属于/);
  const violation = await api("/admin/violations", adminToken, "POST", { userId: buyer.id, type: "risk_trade", level: "moderate", action: "restrict_trade", reason: `阶段三限制测试 ${suffix}`, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
  violationIds.push(violation.id);
  const restrictedConversation = await call(
    `/items/${secondListing.id}/conversations`,
    buyerToken,
    "POST",
    { message: "限制期间测试" },
  );
  assert.equal(restrictedConversation.response.status, 403);
  assert.match(restrictedConversation.body.message, /交易功能已受限/);
  const myTrust = await api("/trust/me", buyerToken);
  assert.equal(myTrust.identity.verified, true);
  assert.ok(myTrust.restrictions.some((entry: any) => entry.id === violation.id));
  const appeal = await api(`/violations/${violation.id}/appeals`, buyerToken, "POST", { content: "这是阶段三自动化测试申诉，包含可核验的完整说明。" });
  appealIds.push(appeal.id);
  const appealHandleRace = await Promise.all([1, 2].map(() => call(
    `/admin/appeals/${appeal.id}`,
    adminToken,
    "PATCH",
    { status: "approved", note: "自动化核验通过，撤销限制" },
  )));
  assert.deepEqual(
    appealHandleRace.map((result) => result.response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const handledAppeal = appealHandleRace.find((result) => result.response.status === 200)!.body.data;
  assert.equal(handledAppeal.status, "approved");
  const restoredConversation = await api(
    `/items/${secondListing.id}/conversations`,
    buyerToken,
    "POST",
    { message: "撤销后恢复" },
  );
  assert.equal(
    (await prisma.marketOrder.findUniqueOrThrow({
      where: { id: restoredConversation.orderId },
    })).status,
    "negotiating",
  );

  const userReportRace = await Promise.all([1, 2].map(() => call(
    `/users/${seller.id}/reports`,
    outsiderToken,
    "POST",
    { reason: "阶段三用户举报", detail: suffix },
  )));
  assert.deepEqual(
    userReportRace.map((result) => result.response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const userReport = userReportRace.find((result) => result.response.status === 200)!.body.data;
  reportIds.push(userReport.id);
  assert.equal(await prisma.marketReport.count({
    where: {
      type: "user",
      reportedUserId: seller.id,
      reporterId: outsider.id,
      status: "pending",
    },
  }), 1);
  const orderReport = await api(`/orders/${reservation.id}/report`, buyerToken, "POST", { reason: "阶段三交易举报", detail: suffix });
  reportIds.push(orderReport.id);
  const wanted = await api("/wanted", buyerToken, "POST", { title: `阶段三求购 ${suffix}`, category: "other", budgetMin: 20, budgetMax: 100, brandModel: "不限", condition: "使用良好", expectedTradeTime: "本周", campus: "SIP", location: "中心楼大厅", description: "阶段三求购举报测试", allowSellerOffers: true, anonymous: true, expiryDays: 21 });
  const wantedResponse = await api(`/wanted/${wanted.id}/responses`, sellerToken, "POST", {
    title: `阶段三响应 ${suffix}`,
    price: 66,
    description: "实体商品响应说明",
    images: ["/uploads/phase3-test.jpg"],
    condition: "good",
    brand: "测试品牌",
    model: "R3",
    availableTime: "周末下午",
  });
  await prisma.marketItem.update({
    where: { id: wantedResponse.itemId },
    data: { digitalDeliveryEncrypted: `workspace-secret-${suffix}` },
  });
  const sellerWorkspace = await api("/mine", sellerToken);
  const workspaceResponse = sellerWorkspace.wantedResponses.find((entry: any) => entry.id === wantedResponse.id);
  assert.ok(workspaceResponse);
  assert.equal(workspaceResponse.wantedPost.authorId, null);
  assert.equal(workspaceResponse.wantedPost.author.nickname.startsWith("匿名同学"), true);
  assert.equal(workspaceResponse.item.digitalDeliveryEncrypted, undefined);
  assert.equal(workspaceResponse.item.hasDigitalDelivery, true);
  const wantedReport = await api(`/wanted/${wanted.id}/reports`, outsiderToken, "POST", { reason: "阶段三求购举报", detail: suffix });
  reportIds.push(wantedReport.id);
  const handledWantedReport = await api(
    `/admin/reports/${wantedReport.id}`,
    adminToken,
    "PATCH",
    { status: "resolved", note: "举报核验成立", hideItem: true },
  );
  assert.equal(handledWantedReport.status, "resolved");
  const [removedWanted, expiredResponse, withdrawnTargetedItem] = await Promise.all([
    prisma.wantedPost.findUniqueOrThrow({ where: { id: wanted.id } }),
    prisma.wantedResponse.findUniqueOrThrow({ where: { id: wantedResponse.id } }),
    prisma.marketItem.findUniqueOrThrow({ where: { id: wantedResponse.itemId } }),
  ]);
  assert.equal(removedWanted.status, "removed");
  assert.equal(expiredResponse.status, "expired");
  assert.equal(withdrawnTargetedItem.status, "withdrawn");
  const overview = await api("/admin/overview", adminToken);
  assert.ok(["user", "trade", "wanted"].every((type) => overview.reports.some((report: any) => report.type === type && reportIds.includes(report.id))));
  const logs = await api("/admin/action-logs?size=100", adminToken);
  assert.ok(logs.list.some((entry: any) => entry.action === "market.violation.create" && entry.targetId === String(buyer.id)));
  assert.equal(logs.list.filter((entry: any) => entry.action === "market.appeal.approved" && entry.targetId === String(appeal.id)).length, 1);
  assert.ok(logs.list.some((entry: any) => entry.action === "market.report.handle" && entry.targetId === String(wantedReport.id)));
  const cancelledReservation = await api(`/orders/${reservation.id}`, buyerToken, "PATCH", { action: "cancel", reason: "阶段三关闭隐私窗口测试" });
  assert.equal(cancelledReservation.status, "cancelled");
  const closedConversation = await api(`/conversations/${linkedConversation!.id}/messages`, buyerToken);
  assert.equal(closedConversation.list.length, 50);
  assert.equal(closedConversation.list.some((message: any) => (
    message.kind === "system" && message.content.includes("结束本次交易洽谈")
  )), true);
  const conversationsAfterCancel = await api("/conversations", buyerToken);
  assert.equal(conversationsAfterCancel.some((entry: any) => entry.id === linkedConversation!.id), true);
});
