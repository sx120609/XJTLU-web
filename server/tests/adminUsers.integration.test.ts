import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "admin-user-integration-secret";

test("admin user routes preserve forum counters and protected business records", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [admin, moderator, responder, protectedBot] = await Promise.all([
    prisma.user.create({
      data: {
        username: `admin_user_admin_${suffix}`,
        passwordHash: "not-used",
        nickname: "用户管理集成管理员",
        role: "admin",
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_user_mod_${suffix}`,
        passwordHash: "not-used",
        nickname: "用户管理集成版主",
        role: "mod",
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_user_reply_${suffix}`,
        passwordHash: "not-used",
        nickname: "用户管理集成回复者",
        replyCount: 1,
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_user_bot_${suffix}`,
        passwordHash: "not-used",
        nickname: "用户管理集成机器人",
        role: "bot",
      },
    }),
  ]);
  const cleanupUserIds = [
    admin.id,
    moderator.id,
    responder.id,
    protectedBot.id,
  ];
  const feedSlug = `admin-user-feed-${suffix}`.toLowerCase();
  let createdUserId: number | null = null;
  let topicId: number | null = null;
  let boardId: number | null = null;

  t.after(async () => {
    await prisma.schoolFeedSource.deleteMany({ where: { slug: feedSlug } });
    if (topicId) await prisma.topic.deleteMany({ where: { id: topicId } });
    if (boardId) {
      const topicCount = await prisma.topic.count({
        where: { boardId, hidden: false },
      });
      await prisma.board.updateMany({
        where: { id: boardId },
        data: { topicCount },
      });
    }
    if (createdUserId) cleanupUserIds.push(createdUserId);
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  });

  const board = await prisma.board.findFirst({ orderBy: { id: "asc" } });
  assert.ok(board, "migrated database must contain at least one forum board");
  boardId = board.id;

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const token = (user: typeof admin) => signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });
  const adminToken = token(admin);
  const moderatorToken = token(moderator);

  async function call(
    path: string,
    bearer: string,
    method = "GET",
    payload?: unknown,
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
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

  const invalidId = await call(
    "/users/not-a-number",
    adminToken,
    "PATCH",
    { nickname: "invalid" },
  );
  assert.equal(invalidId.response.status, 400);

  const moderatorAgainstAdmin = await call(
    `/users/${admin.id}`,
    moderatorToken,
    "PATCH",
    { status: "banned" },
  );
  assert.equal(moderatorAgainstAdmin.response.status, 403);

  const created = await call("/users", adminToken, "POST", {
    username: `aut_${Date.now().toString(36)}`,
    password: "integration-secret",
    nickname: "待删除用户",
  });
  assert.equal(created.response.status, 200, created.body.message);
  const createdData = created.body.data as { id: number };
  createdUserId = createdData.id;
  assert.ok(await prisma.messageSetting.findUnique({
    where: { userId: createdUserId },
  }));

  const topic = await prisma.topic.create({
    data: {
      boardId: board.id,
      authorId: createdUserId,
      title: `用户删除计数测试 ${suffix}`,
      content: "删除主题时需要同步其他作者的回复计数。",
      replyCount: 1,
    },
  });
  topicId = topic.id;
  await prisma.reply.create({
    data: {
      topicId: topic.id,
      authorId: responder.id,
      content: "此回复会随主题删除。",
      floor: 1,
    },
  });
  await prisma.user.update({
    where: { id: createdUserId },
    data: { postCount: 1 },
  });
  await prisma.board.update({
    where: { id: board.id },
    data: { topicCount: { increment: 1 } },
  });

  const deleted = await call(
    `/users/${createdUserId}`,
    adminToken,
    "DELETE",
  );
  assert.equal(deleted.response.status, 200, deleted.body.message);
  assert.deepEqual(deleted.body.data, {
    deletedUserId: createdUserId,
    deletedTopics: 1,
    deletedReplies: 0,
  });
  assert.equal(await prisma.user.findUnique({ where: { id: createdUserId } }), null);
  assert.equal(await prisma.topic.findUnique({ where: { id: topic.id } }), null);
  topicId = null;
  assert.equal(
    (await prisma.user.findUniqueOrThrow({
      where: { id: responder.id },
      select: { replyCount: true },
    })).replyCount,
    0,
  );
  const actualBoardTopicCount = await prisma.topic.count({
    where: { boardId: board.id, hidden: false },
  });
  assert.equal(
    (await prisma.board.findUniqueOrThrow({
      where: { id: board.id },
      select: { topicCount: true },
    })).topicCount,
    actualBoardTopicCount,
  );

  await prisma.schoolFeedSource.create({
    data: {
      slug: feedSlug,
      name: "用户管理删除保护测试",
      homepage: "https://example.invalid/",
      listUrl: "https://example.invalid/list",
      botUserId: protectedBot.id,
    },
  });
  const blocked = await call(
    `/users/${protectedBot.id}`,
    adminToken,
    "DELETE",
  );
  assert.equal(blocked.response.status, 409);
  assert.match(blocked.body.message, /公告抓取源/);
  assert.ok(await prisma.user.findUnique({ where: { id: protectedBot.id } }));
});
