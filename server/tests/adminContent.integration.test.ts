import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "admin-content-integration-secret";

test("admin announcement routes preserve category boundaries and read cleanup", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [admin, user] = await Promise.all([
    prisma.user.create({
      data: {
        username: `admin_content_admin_${suffix}`,
        passwordHash: "not-used",
        nickname: "公告集成管理员",
        role: "admin",
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_content_user_${suffix}`,
        passwordHash: "not-used",
        nickname: "公告集成用户",
        role: "user",
      },
    }),
  ]);
  const protectedNotification = await prisma.notification.create({
    data: {
      userId: null,
      category: "school-feed",
      title: "不可由站务公告接口删除",
      content: "边界测试",
    },
  });
  const createdIds: number[] = [];
  t.after(async () => {
    await prisma.notification.deleteMany({
      where: { id: { in: [...createdIds, protectedNotification.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, user.id] } },
    });
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const adminToken = signToken({
    userId: admin.id,
    studentId: admin.username,
    role: admin.role,
    campus: "SIP",
  });
  const userToken = signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });

  async function call(
    path: string,
    method = "GET",
    payload?: unknown,
    token = adminToken,
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await response.json() as {
      code: number;
      data: unknown;
      message: string;
    };
    return { response, body };
  }

  const forbidden = await call("/announcements", "GET", undefined, userToken);
  assert.equal(forbidden.response.status, 403);

  const unsafe = await call("/announcements", "POST", {
    title: "危险链接",
    content: "不应创建",
    link: "javascript:alert(1)",
  });
  assert.equal(unsafe.response.status, 400);

  const strict = await call("/announcements", "POST", {
    title: "多余字段",
    content: "不应创建",
    category: "school-feed",
  });
  assert.equal(strict.response.status, 400);

  const created = await call("/announcements", "POST", {
    title: "  定向公告  ",
    content: "  仅网页与 iOS 可见  ",
    level: "strong",
    link: "/messages?tab=system",
    source: "  站务测试  ",
    targetClient: ["web", "ios", "web"],
  });
  assert.equal(created.response.status, 200, created.body.message);
  const announcement = created.body.data as {
    id: number;
    title: string;
    content: string;
    targetClient: string | null;
    source: string | null;
  };
  createdIds.push(announcement.id);
  assert.equal(announcement.title, "定向公告");
  assert.equal(announcement.content, "仅网页与 iOS 可见");
  assert.equal(announcement.targetClient, "ios,web");
  assert.equal(announcement.source, "站务测试");

  const emptyPatch = await call(
    `/announcements/${announcement.id}`,
    "PATCH",
    {},
  );
  assert.equal(emptyPatch.response.status, 400);

  const updated = await call(
    `/announcements/${announcement.id}`,
    "PATCH",
    { targetClient: "all", link: null, source: null },
  );
  assert.equal(updated.response.status, 200, updated.body.message);
  assert.deepEqual(
    await prisma.notification.findUniqueOrThrow({
      where: { id: announcement.id },
      select: { targetClient: true, link: true, source: true },
    }),
    { targetClient: null, link: null, source: "站务组" },
  );

  const invalidId = await call(
    "/announcements/not-a-number",
    "PATCH",
    { title: "不会更新" },
  );
  assert.equal(invalidId.response.status, 400);

  const protectedDelete = await call(
    `/announcements/${protectedNotification.id}`,
    "DELETE",
  );
  assert.equal(protectedDelete.response.status, 400);
  assert.ok(
    await prisma.notification.findUnique({
      where: { id: protectedNotification.id },
    }),
  );

  await prisma.notificationRead.create({
    data: { userId: user.id, notificationId: announcement.id },
  });
  const deleted = await call(
    `/announcements/${announcement.id}`,
    "DELETE",
  );
  assert.equal(deleted.response.status, 200, deleted.body.message);
  assert.deepEqual(deleted.body.data, { ok: true });
  assert.equal(
    await prisma.notification.findUnique({ where: { id: announcement.id } }),
    null,
  );
  assert.equal(
    await prisma.notificationRead.count({
      where: { notificationId: announcement.id },
    }),
    0,
  );
  createdIds.splice(createdIds.indexOf(announcement.id), 1);
});
