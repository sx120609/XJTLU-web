import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";

test("management forum review uses independent admin identity and capability checks", async (t) => {
  const { createApp } = await import("../src/app");
  const { prisma } = await import("../src/prisma");
  const { hashPassword } = await import("../src/utils/password");

  const suffix = `${Date.now().toString(36)}_${process.pid}`;
  const admin = await prisma.adminAccount.create({
    data: {
      username: `forum_admin_${suffix}`,
      passwordHash: await hashPassword("forum-admin-password"),
      displayName: "帖子审核管理员",
      accountType: "admin",
    },
  });
  const user = await prisma.user.create({
    data: {
      username: `forum_user_${suffix}`,
      passwordHash: await hashPassword("forum-user-password"),
      nickname: "帖子作者",
      role: "user",
    },
  });
  const board = await prisma.board.create({
    data: {
      slug: `management-forum-${suffix}`,
      name: "管理审核测试板块",
    },
  });
  const topic = await prisma.topic.create({
    data: {
      boardId: board.id,
      authorId: user.id,
      title: `待人工审核帖子 ${suffix}`,
      content: "这是一条需要人工复核的帖子。",
      aiReviewStatus: "manual_requested",
      hidden: true,
    },
  });
  const reply = await prisma.reply.create({
    data: {
      topicId: topic.id,
      authorId: user.id,
      content: "这是一条需要人工复核的回复。",
      aiReviewStatus: "manual_requested",
      hidden: true,
      floor: 0,
    },
  });
  const imageAsset = await prisma.forumImageAsset.create({
    data: {
      url: `/uploads/forum/${suffix}.jpg`,
      localPath: `forum/${suffix}.jpg`,
      status: "rejected",
    },
  });
  const videoAsset = await prisma.forumVideoAsset.create({
    data: {
      url: `/uploads/forum/${suffix}.mp4`,
      localPath: `forum/${suffix}.mp4`,
      status: "manual_review",
    },
  });

  t.after(async () => {
    await prisma.forumImageAsset.deleteMany({ where: { id: imageAsset.id } });
    await prisma.forumVideoAsset.deleteMany({ where: { id: videoAsset.id } });
    await prisma.topic.deleteMany({ where: { id: topic.id } });
    await prisma.board.deleteMany({ where: { id: board.id } });
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.managementAuditLog.deleteMany({ where: { actorId: admin.id } });
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
    password: "forum-admin-password",
  });
  assert.equal(login.response.status, 200, login.body.message);
  const token = login.body.data.token as string;

  const deniedList = await call("/forum/topics?reviewStatus=manual_requested", "GET", token);
  assert.equal(deniedList.response.status, 403);

  await prisma.adminAccountPermission.create({
    data: { adminAccountId: admin.id, permissionCode: "forum.review" },
  });

  const listed = await call(`/forum/topics?q=${encodeURIComponent(suffix)}&reviewStatus=manual_requested`, "GET", token);
  assert.equal(listed.response.status, 200, listed.body.message);
  assert.equal(listed.body.data.list.some((row: { id: number }) => row.id === topic.id), true);

  const reviewedTopic = await call(`/forum/topics/${topic.id}`, "PATCH", token, {
    aiReviewStatus: "approved_manual",
    manualReviewNote: "内容正常，允许发布",
  });
  assert.equal(reviewedTopic.response.status, 200, reviewedTopic.body.message);
  const topicRow = await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } });
  assert.equal(topicRow.aiReviewStatus, "approved_manual");
  assert.equal(topicRow.hidden, false);
  assert.equal(topicRow.manualReviewedById, null);
  assert.equal(topicRow.manualReviewedByAdminId, admin.id);

  const moderateDenied = await call(`/forum/topics/${topic.id}`, "PATCH", token, { hidden: true });
  assert.equal(moderateDenied.response.status, 403);

  const reviewedReply = await call(`/forum/replies/${reply.id}`, "PATCH", token, {
    aiReviewStatus: "rejected_manual",
    manualReviewNote: "回复不适合公开",
  });
  assert.equal(reviewedReply.response.status, 200, reviewedReply.body.message);
  const replyRow = await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } });
  assert.equal(replyRow.manualReviewedById, null);
  assert.equal(replyRow.manualReviewedByAdminId, admin.id);
  assert.equal(replyRow.hidden, true);

  const reviewedImage = await call(`/forum/images/${imageAsset.id}`, "PATCH", token, { status: "approved" });
  assert.equal(reviewedImage.response.status, 200, reviewedImage.body.message);
  const imageRow = await prisma.forumImageAsset.findUniqueOrThrow({ where: { id: imageAsset.id } });
  assert.equal(imageRow.manualReviewedById, null);
  assert.equal(imageRow.manualReviewedByAdminId, admin.id);

  const reviewedVideo = await call(`/forum/videos/${videoAsset.id}`, "PATCH", token, { status: "rejected" });
  assert.equal(reviewedVideo.response.status, 200, reviewedVideo.body.message);
  const videoRow = await prisma.forumVideoAsset.findUniqueOrThrow({ where: { id: videoAsset.id } });
  assert.equal(videoRow.manualReviewedById, null);
  assert.equal(videoRow.manualReviewedByAdminId, admin.id);

  const auditCount = await prisma.managementAuditLog.count({
    where: {
      actorId: admin.id,
      action: { startsWith: "management.forum." },
    },
  });
  assert.equal(auditCount, 4);
});
