import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";

test("management commerce review records independent reviewers for physical items and learning materials", async (t) => {
  const { createApp } = await import("../src/app");
  const { prisma } = await import("../src/prisma");
  const { hashPassword } = await import("../src/utils/password");
  const suffix = `${Date.now().toString(36)}_${process.pid}`;

  const admin = await prisma.adminAccount.create({
    data: {
      username: `commerce_admin_${suffix}`,
      passwordHash: await hashPassword("commerce-admin-password"),
      displayName: "商品资料审核员",
      accountType: "admin",
    },
  });
  const seller = await prisma.user.create({
    data: {
      username: `commerce_seller_${suffix}`,
      passwordHash: await hashPassword("commerce-seller-password"),
      nickname: "审核测试卖家",
      role: "user",
    },
  });
  const physicalItem = await prisma.marketItem.create({
    data: {
      sellerId: seller.id,
      title: `待审核实物 ${suffix}`,
      description: "九成新教材，线下交付。",
      category: "books",
      deliveryType: "physical",
      priceCents: 2600,
      status: "reviewing",
      visibility: "public",
    },
  });
  const learningItem = await prisma.marketItem.create({
    data: {
      sellerId: seller.id,
      title: `待审核学习资料 ${suffix}`,
      description: "课程复习资料。",
      category: "digital_goods",
      deliveryType: "digital",
      priceCents: 1800,
      status: "reviewing",
      visibility: "public",
    },
  });
  const profile = await prisma.learningMaterialProfile.create({ data: { itemId: learningItem.id } });
  const version = await prisma.learningMaterialVersion.create({
    data: { profileId: profile.id, versionNumber: 1, label: "v1", createdById: seller.id },
  });
  const learningReview = await prisma.learningMaterialReview.create({
    data: { versionId: version.id, round: 1, submittedById: seller.id, status: "submitted" },
  });

  t.after(async () => {
    await prisma.managementAuditLog.deleteMany({ where: { actorId: admin.id } });
    await prisma.marketItem.deleteMany({ where: { id: { in: [physicalItem.id, learningItem.id] } } });
    await prisma.notification.deleteMany({ where: { userId: seller.id } });
    await prisma.transactionPointEntry.deleteMany({ where: { userId: seller.id } });
    await prisma.user.deleteMany({ where: { id: seller.id } });
    await prisma.adminAccount.deleteMany({ where: { id: admin.id } });
  });

  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/manage`;

  async function call(path: string, method = "GET", token = "", body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, body: await response.json() as { data: any; message: string } };
  }

  const login = await call("/auth/login", "POST", "", {
    username: admin.username,
    password: "commerce-admin-password",
  });
  assert.equal(login.response.status, 200, login.body.message);
  const token = login.body.data.token as string;

  const denied = await call("/market/reviews", "GET", token);
  assert.equal(denied.response.status, 403);

  await prisma.adminAccountPermission.createMany({
    data: [
      { adminAccountId: admin.id, permissionCode: "market.review" },
      { adminAccountId: admin.id, permissionCode: "learning.review" },
    ],
  });

  const marketQueue = await call(`/market/reviews?q=${encodeURIComponent(suffix)}`, "GET", token);
  assert.equal(marketQueue.response.status, 200, marketQueue.body.message);
  assert.equal(marketQueue.body.data.list.some((row: { id: number }) => row.id === physicalItem.id), true);

  const approvedItem = await call(`/market/reviews/${physicalItem.id}`, "PATCH", token, {
    decision: "approve",
    note: "实物信息与图片一致",
  });
  assert.equal(approvedItem.response.status, 200, approvedItem.body.message);
  const physicalRow = await prisma.marketItem.findUniqueOrThrow({ where: { id: physicalItem.id } });
  assert.equal(physicalRow.status, "active");
  assert.equal(physicalRow.moderatedByAdminId, admin.id);

  const learningQueue = await call("/learning/reviews?status=submitted", "GET", token);
  assert.equal(learningQueue.response.status, 200, learningQueue.body.message);
  assert.equal(learningQueue.body.data.some((row: { id: number }) => row.id === learningReview.id), true);

  const approvedLearning = await call(`/learning/reviews/${learningReview.id}`, "PATCH", token, {
    action: "approve",
    reason: "版权、质量和文件安全检查通过",
    checklist: { rights: true, quality: true, fileSafety: true },
  });
  assert.equal(approvedLearning.response.status, 200, approvedLearning.body.message);
  const learningRow = await prisma.learningMaterialReview.findUniqueOrThrow({ where: { id: learningReview.id } });
  assert.equal(learningRow.status, "approved");
  assert.equal(learningRow.reviewedById, null);
  assert.equal(learningRow.reviewedByAdminId, admin.id);

  const actions = await prisma.managementAuditLog.findMany({
    where: { actorId: admin.id },
    select: { action: true },
  });
  assert.equal(actions.some((row) => row.action === "management.market.item_approved"), true);
  assert.equal(actions.some((row) => row.action === "management.learning.material_approved"), true);
});
