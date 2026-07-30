import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "phase-5-commercialization-secret";

test("stage 5 real routes keep three content promotion flows and reject V1 merchant onboarding", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const users = await Promise.all([
    ["seller", "user"],
    ["viewer", "user"],
    ["admin", "admin"],
  ].map(([label, role]) => prisma.user.create({
    data: {
      username: `phase5_${label}_${suffix}`,
      passwordHash: "not-used",
      nickname: `阶段五${label}_${suffix}`,
      role,
      studentSso: true,
      forumEnabled: true,
      aiReviewWhitelisted: true,
      dataAuthAgreedAt: new Date(),
    },
  })));
  const [seller, viewer, admin] = users;
  const userIds = users.map((user) => user.id);
  const listingPlan = await prisma.promotionPlan.findUniqueOrThrow({ where: { code: "listing_pin_7d" } });
  const originalListingPrice = listingPlan.priceCents;

  t.after(async () => {
    const topics = await prisma.topic.findMany({ where: { authorId: { in: userIds } }, select: { id: true, boardId: true } });
    await prisma.promotionPlan.update({ where: { id: listingPlan.id }, data: { priceCents: originalListingPrice } }).catch(() => null);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.promotionOrder.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.merchantInquiry.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.merchantFavorite.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.merchantProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wantedPost.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.marketItem.deleteMany({ where: { sellerId: { in: userIds } } });
    await prisma.topic.deleteMany({ where: { id: { in: topics.map((topic) => topic.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    for (const boardId of new Set(topics.map((topic) => topic.boardId))) {
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
  const token = (user: typeof seller) => signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "SIP" });
  const sellerToken = token(seller);
  const viewerToken = token(viewer);
  const adminToken = token(admin);

  async function call(path: string, bearer?: string, method = "GET", payload?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Accept-Language": "zh-CN",
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

  async function submitPayment(order: any) {
    assert.match(order.paymentCode, /^\d{4}$/);
    return api(`/market/promotions/orders/${order.id}/payment-claim`, sellerToken, "POST", { paymentCode: order.paymentCode });
  }

  async function confirmPromotion(order: any, reference = `P5-${order.id}`) {
    await submitPayment(order);
    return api(`/market/admin/promotions/orders/${order.id}`, adminToken, "PATCH", {
      action: "confirm",
      verificationMethod: "wechat",
      verificationReference: reference,
      verifiedAmount: Number(order.amount),
      paymentCode: order.paymentCode,
      note: "已核对实收金额、流水和付款备注秘钥",
    });
  }

  const plans = await api("/market/promotions/plans");
  assert.deepEqual(plans.map((plan: any) => plan.code), ["listing_pin_7d", "wanted_urgent_7d", "home_featured_7d"]);
  assert.ok(plans.every((plan: any) => typeof plan.priceCents === "number" && plan.paymentMode === undefined));
  const contentPlans = await api("/market/promotions/plans?scope=content");
  assert.deepEqual(contentPlans.map((plan: any) => plan.code), ["listing_pin_7d", "wanted_urgent_7d", "home_featured_7d"]);
  assert.equal(contentPlans.find((plan: any) => plan.code === "wanted_urgent_7d").maxActive, 8);
  const homePlan = contentPlans.find((plan: any) => plan.code === "home_featured_7d");
  assert.equal(homePlan.maxActive, 8);
  const illegalCapacity = await call(`/market/admin/promotions/plans/${homePlan.id}`, adminToken, "PATCH", { maxActive: 7 });
  assert.equal(illegalCapacity.response.status, 400);
  const merchantPlans = await api("/market/promotions/plans?scope=merchant");
  assert.deepEqual(merchantPlans, []);

  const listingPayload = (title: string) => ({
    listingType: "sell",
    title,
    description: "阶段五推广真实接口与排序验证商品",
    category: "other",
    price: 68,
    negotiable: true,
    condition: "good",
    tradeMode: "meetup",
    campus: "SIP",
    location: "中心楼大厅",
    brand: "测试品牌",
    model: "P5",
    usageDuration: "半年",
    flaws: "轻微使用痕迹",
    accessories: "原包装",
    testAllowed: true,
    availableTime: "工作日 18:00 后",
    images: ["/uploads/phase5-test.jpg"],
  });
  const listing = await api("/market/items", sellerToken, "POST", listingPayload(`阶段五置顶商品 ${suffix}`));
  const pinOrder = await api("/market/promotions/orders", sellerToken, "POST", { planCode: "listing_pin_7d", targetId: listing.id, note: "手工确认测试" });
  assert.equal(pinOrder.status, "pending");
  assert.equal(pinOrder.paymentMode, "manual");
  assert.equal(pinOrder.epay, undefined);
  const beforePayment = await call(`/market/admin/promotions/orders/${pinOrder.id}`, adminToken, "PATCH", { action: "confirm", verificationMethod: "wechat", verificationReference: "P5-BEFORE", verifiedAmount: Number(pinOrder.amount), paymentCode: pinOrder.paymentCode, note: "付款前不得启用" });
  assert.equal(beforePayment.response.status, 400);
  const wrongClaim = await call(`/market/promotions/orders/${pinOrder.id}/payment-claim`, sellerToken, "POST", { paymentCode: pinOrder.paymentCode === "9999" ? "0000" : "9999" });
  assert.equal(wrongClaim.response.status, 400);
  const pinConfirmed = await confirmPromotion(pinOrder, `P5-PIN-${suffix}`);
  assert.equal(pinConfirmed.status, "confirmed");
  assert.equal(pinConfirmed.badgeLabel, "置顶");

  const normalListing = await api("/market/items", sellerToken, "POST", listingPayload(`阶段五普通商品 ${suffix}`));
  const ownFavorite = await call(`/market/items/${listing.id}/favorite`, sellerToken, "POST", {});
  assert.equal(ownFavorite.response.status, 400);
  const concurrentItemFavorites = await Promise.all([
    api(`/market/items/${listing.id}/favorite`, viewerToken, "POST", {}),
    api(`/market/items/${listing.id}/favorite`, viewerToken, "POST", {}),
  ]);
  assert.deepEqual(concurrentItemFavorites.map((result: any) => result.favorited).sort(), [false, true]);
  const favoriteItemAfterConcurrency = await api(`/market/items/${listing.id}`, viewerToken);
  assert.equal(favoriteItemAfterConcurrency.favoriteCount, 0);
  assert.equal(favoriteItemAfterConcurrency.favorited, false);
  const listingRows = await api("/market/items?sort=new&size=50");
  const pinnedIndex = listingRows.list.findIndex((item: any) => item.id === listing.id);
  const normalIndex = listingRows.list.findIndex((item: any) => item.id === normalListing.id);
  assert.ok(pinnedIndex >= 0 && normalIndex >= 0 && pinnedIndex < normalIndex);
  assert.equal(listingRows.list[pinnedIndex].promotions.pinned.label, "置顶");

  const duplicateApplications = await Promise.all([
    call("/market/promotions/orders", sellerToken, "POST", { planCode: "listing_pin_7d", targetId: normalListing.id }),
    call("/market/promotions/orders", sellerToken, "POST", { planCode: "listing_pin_7d", targetId: normalListing.id }),
  ]);
  assert.deepEqual(duplicateApplications.map((result) => result.response.status).sort(), [200, 409]);
  const duplicateWinner = duplicateApplications.find((result) => result.response.status === 200)!.body.data;
  await submitPayment(duplicateWinner);
  const duplicateConfirmationPayload = { action: "confirm", verificationMethod: "wechat", verificationReference: `P5-DUP-${suffix}`, verifiedAmount: Number(duplicateWinner.amount), paymentCode: duplicateWinner.paymentCode, note: "并发确认只能成功一次" };
  const duplicateConfirmations = await Promise.all([
    call(`/market/admin/promotions/orders/${duplicateWinner.id}`, adminToken, "PATCH", duplicateConfirmationPayload),
    call(`/market/admin/promotions/orders/${duplicateWinner.id}`, adminToken, "PATCH", duplicateConfirmationPayload),
  ]);
  assert.deepEqual(duplicateConfirmations.map((result) => result.response.status).sort(), [200, 400]);

  const wantedPayload = (title: string) => ({
    title,
    category: "other",
    budgetMin: 20,
    budgetMax: 100,
    brandModel: "不限",
    condition: "使用良好",
    expectedTradeTime: "本周",
    campus: "SIP",
    location: "中心楼大厅",
    description: "阶段五求购加急真实接口与排序验证",
    allowSellerOffers: true,
    expiryDays: 21,
  });
  const wanted = await api("/market/wanted", sellerToken, "POST", wantedPayload(`阶段五加急求购 ${suffix}`));
  const urgentOrder = await api("/market/promotions/orders", sellerToken, "POST", { planCode: "wanted_urgent_7d", targetId: wanted.id });
  await confirmPromotion(urgentOrder, `P5-WANTED-${suffix}`);
  const normalWanted = await api("/market/wanted", sellerToken, "POST", wantedPayload(`阶段五普通求购 ${suffix}`));
  const wantedRows = await api("/market/wanted?size=50");
  const urgentIndex = wantedRows.list.findIndex((item: any) => item.id === wanted.id);
  const normalWantedIndex = wantedRows.list.findIndex((item: any) => item.id === normalWanted.id);
  assert.ok(urgentIndex >= 0 && normalWantedIndex >= 0 && urgentIndex < normalWantedIndex);
  assert.equal(wantedRows.list[urgentIndex].promotion.urgent.label, "加急");

  const homeOrder = await api("/market/promotions/orders", sellerToken, "POST", { planCode: "home_featured_7d", targetId: listing.id });
  await confirmPromotion(homeOrder, `P5-HOME-${suffix}`);
  const home = await api("/home/summary", sellerToken);
  const homePromotion = home.promotions.find((item: any) => item.id === listing.id);
  assert.equal(homePromotion.promotion.label, "推广");
  assert.ok(home.promotions.length <= 8);
  assert.ok(home.hotTopics.length <= 8);
  assert.equal(home.hotTopics.find((topic: any) => topic.linkedWantedPost?.id === wanted.id)?.promotion?.label, "加急");

  const merchantOnboarding = await call("/market/merchant/me", sellerToken, "PUT", {
    slug: `phase5-${suffix.replaceAll("_", "-")}`.slice(0, 40),
    name: `阶段五校园服务 ${suffix}`.slice(0, 80),
    category: "校园生活",
    description: "为校内同学提供经过审核的生活服务，价格范围和服务区域均公开透明。",
    priceRange: "20—80 元/次",
    serviceArea: "SIP 校区及周边",
    studentDiscount: "学生身份可享九折",
    contactMethod: "wechat",
    contactValue: `phase5_wechat_${suffix}`,
    images: ["/uploads/phase5-merchant.jpg"],
  });
  assert.equal(merchantOnboarding.response.status, 403);
  assert.match(merchantOnboarding.body.message, /可直接发布实物商品/);
  const merchantPromotion = await call("/market/promotions/orders", sellerToken, "POST", {
    planCode: "merchant_homepage_30d",
    targetId: 1,
  });
  assert.equal(merchantPromotion.response.status, 403);
  const contentOrders = await api("/market/promotions/orders?scope=content&size=50", sellerToken);
  assert.ok(contentOrders.list.length >= 3);
  assert.ok(contentOrders.list.every((order: any) => order.targetType !== "merchant_profile"));

  const search = await api(`/search?q=${encodeURIComponent(suffix)}`, sellerToken);
  assert.ok(search.marketItems.some((item: any) => item.id === listing.id && item.promotions.pinned?.label === "置顶"));
  assert.ok(search.wantedPosts.some((post: any) => post.id === wanted.id && post.promotion.urgent?.label === "加急"));

  await api(`/market/promotions/orders/${homeOrder.id}/events`, sellerToken, "POST", { type: "impression" });
  await api(`/market/promotions/orders/${homeOrder.id}/events`, sellerToken, "POST", { type: "impression" });
  await api(`/market/promotions/orders/${homeOrder.id}/events`, sellerToken, "POST", { type: "click" });
  for (const spoofedAddress of ["198.51.100.10", "198.51.100.11"]) {
    const response = await fetch(`${baseUrl}/market/promotions/orders/${homeOrder.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "phase5-guest", "X-Forwarded-For": spoofedAddress },
      body: JSON.stringify({ type: "impression" }),
    });
    assert.equal(response.status, 200);
  }
  const analytics = await prisma.promotionOrder.findUniqueOrThrow({ where: { id: homeOrder.id } });
  assert.equal(analytics.impressionCount, 2);
  assert.equal(analytics.clickCount, 1);
  assert.equal(await prisma.promotionEvent.count({ where: { orderId: homeOrder.id } }), 3);

  const emptyPrice = await call(`/market/admin/promotions/plans/${listingPlan.id}`, adminToken, "PATCH", { price: "" });
  assert.equal(emptyPrice.response.status, 400);
  const changedPlan = await api(`/market/admin/promotions/plans/${listingPlan.id}`, adminToken, "PATCH", { price: 6.73 });
  assert.equal(changedPlan.priceCents, 673);
  const pricedOrder = await api("/market/promotions/orders", sellerToken, "POST", { planCode: "listing_pin_7d", targetId: listing.id });
  assert.equal(pricedOrder.amountCents, 673);
  assert.equal(pricedOrder.paymentMode, "manual");
  await submitPayment(pricedOrder);
  const paidRejection = await api(`/market/admin/promotions/orders/${pricedOrder.id}`, adminToken, "PATCH", { action: "reject", note: "推广对象信息需补充，已通过站内沟通联系退款" });
  assert.equal(paidRejection.status, "rejected");
  assert.ok(paidRejection.paymentSubmittedAt);
  const refundNotice = await prisma.notification.findFirstOrThrow({ where: { userId: seller.id, title: "推广未通过，请联系退款" }, orderBy: { createdAt: "desc" } });
  assert.match(refundNotice.content, /不会自动退款/);
  await api(`/market/admin/promotions/plans/${listingPlan.id}`, adminToken, "PATCH", { price: originalListingPrice / 100 });

  const overview = await api("/market/admin/promotions/overview", adminToken);
  assert.ok(overview.impressions >= 1 && overview.clicks >= 1);
  const meta = await api("/market/meta", sellerToken);
  assert.equal(meta.paymentEnabled, false);
  assert.deepEqual(meta.payTypes, []);
});
