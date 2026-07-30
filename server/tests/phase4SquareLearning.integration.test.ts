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
        "Accept-Language": "zh-CN",
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
  assert.deepEqual(marketMeta.conditions, ["new", "like_new", "good", "fair"]);
  assert.deepEqual(marketMeta.tradeModes, ["meetup", "shipping", "online", "any"]);
  const missingCondition = await call("/market/items", "POST", {
    listingType: "sell",
    title: `缺少成色 ${suffix}`,
    description: "商品成色必须由发布者明确选择，不能由后端静默补默认值。",
    category: "other",
    price: 10,
    draft: true,
  });
  assert.equal(missingCondition.response.status, 400);
  const missingCategory = await call("/market/items", "POST", {
    listingType: "sell",
    title: `missing category ${suffix}`,
    description: "A physical sale listing must have an explicit category.",
    price: 10,
    condition: "good",
    draft: true,
  });
  assert.equal(missingCategory.response.status, 400);
  const missingTradeMode = await call("/market/items", "POST", {
    listingType: "sell",
    title: `missing delivery mode ${suffix}`,
    description: "A starred delivery mode must be submitted explicitly.",
    category: "other",
    price: 10,
    condition: "good",
    draft: true,
  });
  assert.equal(missingTradeMode.response.status, 400);
  const forumPostCountBeforeProducts = (await prisma.user.findUnique({ where: { id: user.id }, select: { postCount: true } }))!.postCount;
  const marketBoardBeforeProducts = await prisma.board.findUnique({ where: { slug: "market" }, select: { topicCount: true } });

  const draftTitle = `阶段四私有出售草稿 ${suffix}`;
  const draftListing = await api("/market/items", "POST", {
    listingType: "sell",
    title: draftTitle,
    description: "保存后只能由卖家在市集草稿中查看，不能进入任何公开帖子流。",
    category: "other",
    price: 35,
    negotiable: false,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "",
    flaws: "",
    availableTime: "",
    images: [],
    draft: true,
  });
  assert.equal(draftListing.listingType, "sell");
  assert.equal(draftListing.status, "draft");
  const persistedDraft = await prisma.marketItem.findUnique({ where: { id: draftListing.id }, select: { topicId: true } });
  assert.equal(persistedDraft?.topicId, null);
  const ownerDraftDetail = await api(`/market/items/${draftListing.id}`);
  assert.equal(ownerDraftDetail.id, draftListing.id);
  const publicDraftDetail = await call(`/market/items/${draftListing.id}`, "GET", undefined, false);
  assert.equal(publicDraftDetail.response.status, 404);
  const publicDraftList = await call("/market/items?status=draft", "GET", undefined, false);
  assert.equal(publicDraftList.response.status, 400);
  assert.match(publicDraftList.body.message, /草稿.*“我的”页面/);

  const listingTitle = `阶段四关联商品 ${suffix}`;
  const listing = await api("/market/items", "POST", {
    listingType: "sell",
    title: listingTitle,
    description: "用于验证帖子与公开商品的独立关联",
    category: "other",
    price: 66,
    originalPrice: 999,
    negotiable: true,
    condition: "good",
    tradeMode: "any",
    campus: "苏州校区",
    location: "",
    brand: "测试品牌",
    model: "P4",
    usageDuration: "半年",
    flaws: "轻微使用痕迹",
    accessories: "包装",
    testAllowed: true,
    availableTime: "工作日 18:00 后",
    images: ["/uploads/phase4-test.jpg"],
  });
  assert.equal(listing.campus, "SIP");
  assert.equal(listing.tradeMode, "any");
  assert.equal(listing.expiresAt, null);
  assert.equal(listing.topicId, null);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id }, select: { postCount: true } }))!.postCount, forumPostCountBeforeProducts);
  assert.equal((await prisma.board.findUnique({ where: { slug: "market" }, select: { topicCount: true } }))?.topicCount, marketBoardBeforeProducts?.topicCount);

  const campusOptionalListing = await api("/market/items", "POST", {
    listingType: "sell",
    title: `optional campus item ${suffix}`,
    description: "An active physical listing can be published without selecting a campus.",
    category: "other",
    price: 45,
    condition: "like_new",
    tradeMode: "shipping",
    images: ["/uploads/phase4-optional-campus.jpg"],
  });
  assert.equal(campusOptionalListing.status, "active");
  assert.equal(campusOptionalListing.campus, "");
  assert.equal(campusOptionalListing.location, "");
  assert.equal(campusOptionalListing.availableTime, "");

  const expensiveListing = await api("/market/items", "POST", {
    listingType: "sell",
    title: `filter regression item ${suffix}`,
    description: "Used to verify that sale price, condition, campus and delivery filters all read saved listing fields.",
    category: "other",
    price: 666,
    originalPrice: 1,
    condition: "fair",
    tradeMode: "online",
    campus: "TC",
    images: ["/uploads/phase4-filter-test.jpg"],
  });
  assert.equal(expensiveListing.expiresAt, null);

  const priceFiltered = await api("/market/items?minPrice=60&maxPrice=100&page=1&size=60", "GET", undefined, false);
  assert.equal(priceFiltered.list.some((item: any) => item.id === listing.id), true);
  assert.equal(priceFiltered.list.some((item: any) => item.id === expensiveListing.id), false);
  const anyDelivery = await api("/market/items?tradeMode=any&page=1&size=60", "GET", undefined, false);
  assert.equal(anyDelivery.list.some((item: any) => item.id === listing.id), true);
  assert.equal(anyDelivery.list.some((item: any) => item.id === expensiveListing.id), true);
  const onlineDelivery = await api("/market/items?tradeMode=online&page=1&size=60", "GET", undefined, false);
  assert.equal(onlineDelivery.list.some((item: any) => item.id === listing.id), false);
  assert.equal(onlineDelivery.list.some((item: any) => item.id === expensiveListing.id), true);
  const fieldFiltered = await api("/market/items?condition=fair&campus=TC&category=other&page=1&size=60", "GET", undefined, false);
  assert.equal(fieldFiltered.list.some((item: any) => item.id === expensiveListing.id), true);
  assert.equal(fieldFiltered.list.some((item: any) => item.id === campusOptionalListing.id), false);

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
  assert.equal(anonymousStateAfterWanted?.anonymousCredits, 2);

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

  // 商品本身没有 Topic；首页和“全部帖子”只读取广场公开频道，求购需求仍是帖子。
  await prisma.topic.update({ where: { id: wanted.topicId }, data: { likeCount: 1_000_000, lastReplyAt: new Date() } });
  const home = await api("/home/summary");
  assert.equal(home.hotTopics.some((topic: any) => topic.title === draftTitle), false);
  assert.equal(home.latestTopics.some((topic: any) => topic.title === draftTitle), false);
  assert.equal(home.hotTopics.some((topic: any) => topic.title === listingTitle), false);
  assert.equal(home.latestTopics.some((topic: any) => topic.title === listingTitle), false);
  assert.equal(home.hotTopics.some((topic: any) => topic.id === wanted.topicId), true);

  const allSquareTopics = await api("/topics?board=all&page=1&size=50&sort=hot");
  assert.equal(allSquareTopics.list.some((topic: any) => topic.title === draftTitle), false);
  assert.equal(allSquareTopics.list.some((topic: any) => topic.title === listingTitle), false);
  assert.equal(allSquareTopics.list.some((topic: any) => topic.id === wanted.topicId), true);

  const search = await api(`/search?q=${encodeURIComponent(listingTitle)}`);
  assert.equal(search.marketItems.some((item: any) => item.id === listing.id), true);
  assert.equal(search.marketItems.some((item: any) => item.id === draftListing.id), false);
  assert.equal(search.topics.some((topic: any) => topic.title === listingTitle), false);

  // 同一条出售内容从草稿正式上架、再退回草稿时，只改变商品状态，不生成或同步论坛 Topic。
  const publishedDraft = await api(`/market/items/${draftListing.id}`, "PATCH", {
    listingType: "sell",
    title: draftTitle,
    description: "完成信息后正式上架，再验证退回草稿仍不会公开。",
    category: "other",
    price: 35,
    negotiable: false,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "",
    flaws: "无明显瑕疵",
    availableTime: "工作日 18:00 后",
    images: ["/uploads/phase4-draft-publish.jpg"],
    draft: false,
    status: "active",
  });
  assert.equal(publishedDraft.status, "active");
  assert.equal(publishedDraft.topicId, null);
  assert.equal(publishedDraft.campus, "SIP");
  assert.equal(publishedDraft.location, "");
  assert.equal(publishedDraft.expiresAt, null);
  assert.equal((await call(`/market/items/${draftListing.id}`, "GET", undefined, false)).response.status, 200);
  const resavedDraft = await api(`/market/items/${draftListing.id}`, "PATCH", {
    ...publishedDraft,
    images: publishedDraft.images.map((image: any) => image.url),
    draft: true,
    status: "draft",
  });
  assert.equal(resavedDraft.status, "draft");
  assert.equal(resavedDraft.topicId, null);
  assert.equal((await call(`/market/items/${draftListing.id}`, "GET", undefined, false)).response.status, 404);

  const materialMeta = await api("/market/materials/meta");
  assert.equal(materialMeta.commerce.paidEnabled, true);
  const publisherContext = await api("/market/materials/commerce/creator/me");
  assert.equal(publisherContext.publishingAllowed, true);
  assert.equal(publisherContext.publishingStatus, "active");
  assert.equal(publisherContext.profile.status, "active");
  assert.equal(
    await prisma.learningCreatorProfile.count({ where: { userId: user.id, status: "active" } }),
    1,
  );
  const forumPostCountBeforeMaterial = (await prisma.user.findUnique({ where: { id: user.id }, select: { postCount: true } }))!.postCount;
  const draftMaterial = await api("/market/materials/items", "POST", {
    title: `阶段四独立学习资料草稿 ${suffix}`,
    description: "用于验证学习资料属于独立商品域，不会自动生成广场帖子。",
    price: Number(materialMeta.commerce.minPrice),
    images: [],
    draft: true,
    profile: {
      courseCode: "P4TEST101",
      applicableSemester: "Y1S1",
      typeId: materialMeta.types[0].id,
      fileFormats: ["PDF"],
      pageCount: 1,
      versionLabel: "测试草稿",
      language: "zh-CN",
      originalityKind: "original",
      originalityStatement: "集成测试原创声明",
      rightsConfirmed: true,
    },
  });
  assert.equal(draftMaterial.status, "draft");
  assert.equal(draftMaterial.topicId, null);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id }, select: { postCount: true } }))!.postCount, forumPostCountBeforeMaterial);
  assert.equal((await call(`/market/materials/items/${draftMaterial.id}`, "GET", undefined, false)).response.status, 404);
  const publicDraftMaterials = await call("/market/materials/items?status=draft", "GET", undefined, false);
  assert.equal(publicDraftMaterials.response.status, 400);
  assert.match(publicDraftMaterials.body.message, /草稿.*“资料发布中心”/);

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
    price: Number(materialMeta.commerce.minPrice),
    profile: {},
    draft: true,
  });
  assert.equal(blockedLearning.response.status, 400);
  assert.match(blockedLearning.body.message, /教师课件/);

  const resources = await api("/services?category=%E5%AD%A6%E4%B9%A0", "GET", undefined, false);
  assert.deepEqual(resources.map((resource: any) => resource.code), ["XJTLU_LIBRARY", "XJTLU_LM_CORE", "XJTLU_KNOWLEDGE_BASE"]);
});
