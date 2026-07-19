import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-4-square-learning-secret";

test("real routes expose twelve square channels, linked discussions, scoped rules and official learning resources", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const { ensureBuiltinBoards } = await import("../src/services/defaultBoards");
  const { currentAnonymousWeekKey } = await import("../src/services/userTrust");
  await ensureBuiltinBoards();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const user = await prisma.user.create({
    data: {
      username: `phase4_${suffix}`,
      passwordHash: "not-used",
      nickname: `阶段四用户_${suffix}`,
      role: "user",
      studentSso: true,
      forumEnabled: true,
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      anonymousCredits: 2,
      anonymousWeekKey: currentAnonymousWeekKey(),
      aiReviewWhitelisted: true,
      dataAuthAgreedAt: new Date(),
    },
  });

  t.after(async () => {
    const topicRows = await prisma.topic.findMany({ where: { authorId: user.id }, select: { id: true, boardId: true } });
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.wantedPost.deleteMany({ where: { authorId: user.id } });
    await prisma.marketItem.deleteMany({ where: { sellerId: user.id } });
    await prisma.topic.deleteMany({ where: { id: { in: topicRows.map((row) => row.id) } } });
    await prisma.user.delete({ where: { id: user.id } });
    for (const boardId of new Set(topicRows.map((row) => row.boardId))) {
      const topicCount = await prisma.topic.count({ where: { boardId, hidden: false } });
      await prisma.board.update({ where: { id: boardId }, data: { topicCount } });
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
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const token = signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "SIP" });

  async function call(path: string, method = "GET", payload?: unknown, authenticated = true) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await response.json() as { code: number; data: any; message: string };
    return { response, body };
  }

  async function api(path: string, method = "GET", payload?: unknown, authenticated = true) {
    const result = await call(path, method, payload, authenticated);
    assert.equal(result.response.status, 200, `${method} ${path}: ${result.body.message}`);
    assert.equal(result.body.code, 0, `${method} ${path}: ${result.body.message}`);
    return result.body.data;
  }

  const boards = await api("/boards");
  assert.deepEqual(boards.filter((board: any) => board.section).map((board: any) => board.slug), [
    "general", "wanted-demand", "freshman", "question",
    "study", "ielts", "study-abroad", "coursereview",
    "life", "clubs", "treehole", "friends",
  ]);
  assert.ok(boards.filter((board: any) => board.section).every((board: any) => board.anonymousEnabled));
  assert.equal(boards.find((board: any) => board.slug === "wanted-demand")?.color, "#ea580c");
  const marketMeta = await api("/market/meta", "GET", undefined, false);
  assert.deepEqual(marketMeta.campuses, ["SIP", "TC"]);

  const listing = await api("/market/items", "POST", {
    listingType: "sell",
    title: `阶段四关联商品 ${suffix}`,
    description: "用于验证帖子与公开商品的独立关联",
    category: "other",
    price: 66,
    negotiable: true,
    condition: "good",
    tradeMode: "meetup",
    campus: "苏州校区",
    location: "中心楼大厅",
    brand: "测试品牌",
    model: "P4",
    usageDuration: "半年",
    flaws: "轻微使用痕迹",
    accessories: "包装",
    testAllowed: true,
    availableTime: "工作日 18:00 后",
    contactVisibility: "after_accept",
    expiryDays: 30,
    images: ["/uploads/phase4-test.jpg"],
  });
  assert.equal(listing.campus, "SIP");
  const itemTopic = await api("/topics", "POST", {
    boardSlug: "trade-talk",
    title: `请帮忙估价 ${suffix}`,
    content: "想了解这件物品目前在校园内的合理价格。",
    linkedMarketItemId: listing.id,
  });
  const itemTopicDetail = await api(`/topics/${itemTopic.id}`);
  assert.equal(itemTopicDetail.linkedMarketItem.id, listing.id);
  assert.equal(itemTopicDetail.linkedMarketItem.title, listing.title);

  const wanted = await api("/market/wanted", "POST", {
    title: `阶段四关联求购 ${suffix}`,
    category: "other",
    budgetMin: 20,
    budgetMax: 90,
    brandModel: "不限",
    condition: "使用良好",
    expectedTradeTime: "本周",
    campus: "太仓",
    location: "中心楼大厅",
    description: "用于验证帖子与公开求购的独立关联",
    allowSellerOffers: true,
    anonymous: true,
    expiryDays: 21,
  });
  assert.equal(wanted.campus, "TC");
  assert.equal(wanted.isAnonymous, true);
  assert.equal(wanted.authorId, null);
  assert.equal(wanted.author.anonymous, true);
  assert.match(wanted.author.nickname, /^匿名同学/);
  assert.ok(Number.isInteger(wanted.topicId) && wanted.topicId > 0);
  assert.equal(wanted.topicUrl, `/forum/topic/${wanted.topicId}`);
  const wantedDemandTopic = await api(`/topics/${wanted.topicId}`);
  assert.equal(wantedDemandTopic.board.slug, "wanted-demand");
  assert.equal(wantedDemandTopic.isAnonymous, true);
  assert.match(wantedDemandTopic.author.nickname, /^匿名同学/);
  assert.equal(wantedDemandTopic.linkedWantedPost.id, wanted.id);
  const latestWanted = await api("/market/wanted?page=1&size=60&campus=%E5%A4%AA%E4%BB%93");
  const listedWanted = latestWanted.list.find((entry: any) => entry.id === wanted.id);
  assert.equal(listedWanted?.topicUrl, `/forum/topic/${wanted.topicId}`);
  assert.equal(listedWanted?.authorId, null);
  assert.equal(listedWanted?.author?.anonymous, true);
  const anonymousStateAfterWanted = await prisma.user.findUnique({ where: { id: user.id }, select: { anonymousCredits: true } });
  assert.equal(anonymousStateAfterWanted?.anonymousCredits, 1);

  const duplicateWantedTopic = await call("/topics", "POST", {
    boardSlug: "wanted-demand",
    title: `绕过结构化发布 ${suffix}`,
    content: "不应允许普通帖子直接进入求购需求专区。",
  });
  assert.equal(duplicateWantedTopic.response.status, 400);
  assert.match(duplicateWantedTopic.body.message, /结构化求购发布入口/);

  const wantedTopic = await api("/topics", "POST", {
    boardSlug: "trade-talk",
    title: `求购建议 ${suffix}`,
    content: "这个预算是否合理，希望有经验的同学给些建议。",
    linkedWantedPostId: wanted.id,
  });
  const wantedTopicDetail = await api(`/topics/${wantedTopic.id}`);
  assert.equal(wantedTopicDetail.linkedWantedPost.id, wanted.id);

  const blockedForum = await call("/topics", "POST", {
    boardSlug: "question",
    title: `代写服务 ${suffix}`,
    content: "提供课程作业代写。",
  });
  assert.equal(blockedForum.response.status, 400);
  assert.match(blockedForum.body.message, /禁止代写/);

  const blockedLearning = await call("/market/materials/items", "POST", {
    title: `教师课件合集 ${suffix}`,
    description: "未经授权的课堂文件",
    price: 0,
    profile: {},
    draft: true,
  });
  assert.equal(blockedLearning.response.status, 400);
  assert.match(blockedLearning.body.message, /教师课件/);

  const resources = await api("/services?category=%E5%AD%A6%E4%B9%A0", "GET", undefined, false);
  assert.deepEqual(resources.map((resource: any) => resource.code), ["XJTLU_LIBRARY", "XJTLU_LM_CORE", "XJTLU_KNOWLEDGE_BASE"]);
});
