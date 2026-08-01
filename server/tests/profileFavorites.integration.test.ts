import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { installIntegrationPromotionPlans } from "./integrationPromotionPlans";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "profile-favorites-integration-secret";

test("global favorites aggregate V1 content and exclude retired merchants", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const promotionPlans = await installIntegrationPromotionPlans(prisma);

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [owner, viewer] = await Promise.all([
    prisma.user.create({
      data: {
        username: `favorite_owner_${suffix}`,
        passwordHash: "not-used",
        nickname: `收藏内容发布者_${suffix}`,
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
    prisma.user.create({
      data: {
        username: `favorite_viewer_${suffix}`,
        passwordHash: "not-used",
        nickname: `收藏用户_${suffix}`,
        studentSso: true,
        forumEnabled: true,
        dataAuthAgreedAt: new Date(),
      },
    }),
  ]);
  const board = await prisma.board.findUniqueOrThrow({ where: { slug: "general" } });
  const topic = await prisma.topic.create({
    data: {
      boardId: board.id,
      authorId: owner.id,
      title: `全局收藏帖子_${suffix}`,
      content: "用于验证帖子收藏与点赞保持独立。",
    },
  });
  const [physicalItem, learningItem] = await Promise.all([
    prisma.marketItem.create({
      data: {
        sellerId: owner.id,
        title: `全局收藏商品_${suffix}`,
        description: "可见的实物商品收藏。",
        category: "other",
        deliveryType: "physical",
        priceCents: 6600,
        status: "active",
        visibility: "public",
      },
    }),
    prisma.marketItem.create({
      data: {
        sellerId: owner.id,
        title: `全局收藏学习资料_${suffix}`,
        description: "可见的学习资料收藏。",
        category: "digital_goods",
        deliveryType: "digital",
        priceCents: 1200,
        status: "active",
        visibility: "public",
      },
    }),
  ]);
  const plan = promotionPlans.get("merchant_homepage_30d");
  const now = new Date();
  const merchant = await prisma.merchantProfile.create({
    data: {
      userId: owner.id,
      slug: `favorite-${suffix.replace(/_/g, "-")}`.toLowerCase(),
      name: `全局收藏商户_${suffix}`,
      category: "校园服务",
      description: "处于有效展示期的校园商户。",
      priceRange: "按次报价",
      serviceArea: "SIP 校区",
      contactMethod: "wechat",
      contactValueEncrypted: "test",
      contactValueMasked: "t***t",
      status: "approved",
      activeUntil: new Date(now.getTime() + 86_400_000),
    },
  });
  const promotionOrder = await prisma.promotionOrder.create({
    data: {
      userId: owner.id,
      planId: plan.id,
      merchantProfileId: merchant.id,
      outTradeNo: `FAV-${suffix}`,
      planCode: plan.code,
      planName: plan.name,
      type: plan.type,
      targetType: plan.targetType,
      placement: plan.placement,
      amountCents: plan.priceCents,
      durationDays: plan.durationDays,
      status: "confirmed",
      startsAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 86_400_000),
      confirmedAt: now,
    },
  });
  await prisma.merchantProfile.update({
    where: { id: merchant.id },
    data: { activePromotionOrderId: promotionOrder.id },
  });

  t.after(async () => {
    await prisma.promotionOrder.deleteMany({ where: { id: promotionOrder.id } });
    await prisma.merchantProfile.deleteMany({ where: { id: merchant.id } });
    await prisma.marketItem.deleteMany({ where: { id: { in: [physicalItem.id, learningItem.id] } } });
    await prisma.topic.deleteMany({ where: { id: topic.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
    await promotionPlans.restore();
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
  const token = signToken({
    userId: viewer.id,
    studentId: viewer.username,
    role: viewer.role,
    campus: "SIP",
  });

  async function api(path: string, method = "GET") {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json() as { code: number; data: any; message: string };
    assert.equal(response.status, 200, `${method} ${path}: ${body.message}`);
    assert.equal(body.code, 0, `${method} ${path}: ${body.message}`);
    return body.data;
  }

  assert.equal((await api(`/topics/${topic.id}/favorite`, "POST")).favorited, true);
  assert.equal((await api(`/market/items/${physicalItem.id}/favorite`, "POST")).favorited, true);
  await prisma.marketFavorite.create({
    data: { itemId: learningItem.id, userId: viewer.id },
  });
  await prisma.merchantFavorite.create({
    data: { merchantProfileId: merchant.id, userId: viewer.id },
  });

  const all = await api("/user/me/favorites?type=all&size=10");
  assert.deepEqual(
    new Set(all.list.map((entry: any) => entry.type)),
    new Set(["topic", "market_item", "learning_material"]),
  );
  assert.deepEqual(all.counts, {
    all: 3,
    topic: 1,
    market_item: 1,
    learning_material: 1,
  });
  assert.equal(all.list.some((entry: any) => entry.type === "merchant"), false);
  assert.equal((await api("/user/me/favorites?type=topic&size=10")).list[0].href, `/forum/topic/${topic.id}`);
  assert.equal((await api("/user/me/favorites?type=market_item&size=10")).list[0].href, `/market/item/${physicalItem.id}`);
  assert.equal((await api("/user/me/favorites?type=learning_material&size=10")).list[0].href, `/learning/materials/item/${learningItem.id}`);

  assert.equal((await api(`/topics/${topic.id}/favorite`, "POST")).favorited, false);
  const withoutTopic = await api("/user/me/favorites?type=topic&size=10");
  assert.equal(withoutTopic.counts.topic, 0);
  assert.deepEqual(withoutTopic.list, []);
});
