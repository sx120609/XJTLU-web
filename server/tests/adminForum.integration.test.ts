import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "admin-forum-integration-secret";

test("admin forum moderation serializes floors and repairs dependent counters", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const {
    getGlobalPinnedTopicIds,
    isGlobalPinnedTopic,
    setGlobalPinnedTopicIds,
    setTopicGlobalPinned,
  } = await import("../src/services/siteSettings");

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const originalGlobalPins = getGlobalPinnedTopicIds();
  const [admin, author, responder] = await Promise.all([
    prisma.user.create({
      data: {
        username: `admin_forum_admin_${suffix}`,
        passwordHash: "not-used",
        nickname: "论坛审核集成管理员",
        role: "admin",
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_forum_author_${suffix}`,
        passwordHash: "not-used",
        nickname: "论坛审核集成作者",
        postCount: 1,
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_forum_reply_${suffix}`,
        passwordHash: "not-used",
        nickname: "论坛审核集成回复者",
      },
    }),
  ]);
  const cleanupUserIds = [admin.id, author.id, responder.id];
  let topicId: number | null = null;
  let courseId: number | null = null;
  let boardId: number | null = null;

  t.after(async () => {
    await setGlobalPinnedTopicIds(originalGlobalPins);
    if (topicId) {
      await prisma.courseRating.deleteMany({ where: { topicId } });
      await prisma.topic.deleteMany({ where: { id: topicId } });
    }
    if (courseId) await prisma.course.deleteMany({ where: { id: courseId } });
    if (boardId) {
      const topicCount = await prisma.topic.count({
        where: { boardId, hidden: false },
      });
      await prisma.board.updateMany({
        where: { id: boardId },
        data: { topicCount },
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  });

  const board = await prisma.board.findFirst({
    where: { readOnly: false },
    orderBy: { id: "asc" },
  });
  assert.ok(board, "migrated database must contain a writable forum board");
  boardId = board.id;
  const actualBoardCount = await prisma.topic.count({
    where: { boardId: board.id, hidden: false },
  });
  const topic = await prisma.topic.create({
    data: {
      boardId: board.id,
      authorId: author.id,
      title: `论坛审核事务测试 ${suffix}`,
      content: "审核放行的回复必须获得不同楼层，永久删除必须修复所有计数。",
      aiReviewStatus: "auto_passed",
      lastReplyAt: new Date(),
      lastReplyById: author.id,
    },
  });
  topicId = topic.id;
  await prisma.board.update({
    where: { id: board.id },
    data: { topicCount: actualBoardCount + 1 },
  });
  const [replyA, replyB] = await Promise.all([
    prisma.reply.create({
      data: {
        topicId: topic.id,
        authorId: responder.id,
        content: "第一条待人工审核回复",
        hidden: true,
        floor: 0,
        aiReviewStatus: "manual_requested",
      },
    }),
    prisma.reply.create({
      data: {
        topicId: topic.id,
        authorId: author.id,
        content: "第二条待人工审核回复",
        hidden: true,
        floor: 0,
        aiReviewStatus: "manual_requested",
      },
    }),
  ]);
  const course = await prisma.course.create({
    data: {
      code: `ADMIN_FORUM_${suffix}`,
      name: "论坛审核集成课程",
      teacher: "集成测试",
      ratingCount: 1,
      avgDifficulty: 4,
      avgReward: 5,
      avgRecommend: 5,
      avgScore: 4,
    },
  });
  courseId = course.id;
  await prisma.courseRating.create({
    data: {
      topicId: topic.id,
      courseId: course.id,
      authorId: author.id,
      difficulty: 4,
      reward: 5,
      recommend: 5,
      givingScore: 4,
    },
  });
  await setTopicGlobalPinned(topic.id, true);
  assert.equal(isGlobalPinnedTopic(topic.id), true);

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const token = signToken({
    userId: admin.id,
    studentId: admin.username,
    role: admin.role,
    campus: "SIP",
  });

  async function call(
    path: string,
    method = "GET",
    payload?: unknown,
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
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

  const invalidQuery = await call("/topics?unexpected=1");
  assert.equal(invalidQuery.response.status, 400);
  const invalidId = await call(
    "/topics/not-a-number",
    "PATCH",
    { hidden: true },
  );
  assert.equal(invalidId.response.status, 400);

  const approvals = await Promise.all([
    call(`/replies/${replyA.id}`, "PATCH", {
      aiReviewStatus: "approved_manual",
      manualReviewNote: "并发审核 A",
    }),
    call(`/replies/${replyB.id}`, "PATCH", {
      aiReviewStatus: "approved_manual",
      manualReviewNote: "并发审核 B",
    }),
  ]);
  for (const approval of approvals) {
    assert.equal(approval.response.status, 200, approval.body.message);
  }

  const approvedReplies = await prisma.reply.findMany({
    where: { id: { in: [replyA.id, replyB.id] } },
    orderBy: { floor: "asc" },
    select: {
      id: true,
      floor: true,
      hidden: true,
      manualReviewedById: true,
      manualReviewedAt: true,
      manualReviewNote: true,
    },
  });
  assert.deepEqual(approvedReplies.map((reply) => reply.floor), [1, 2]);
  assert.ok(approvedReplies.every((reply) => !reply.hidden));
  assert.ok(approvedReplies.every((reply) => reply.manualReviewedById === admin.id));
  assert.ok(approvedReplies.every((reply) => reply.manualReviewedAt instanceof Date));
  assert.deepEqual(
    new Set(approvedReplies.map((reply) => reply.manualReviewNote)),
    new Set(["并发审核 A", "并发审核 B"]),
  );
  const updatedTopic = await prisma.topic.findUniqueOrThrow({
    where: { id: topic.id },
    select: { replyCount: true },
  });
  assert.equal(updatedTopic.replyCount, 2);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({
      where: { id: responder.id },
      select: { replyCount: true },
    })).replyCount,
    1,
  );
  assert.equal(
    (await prisma.user.findUniqueOrThrow({
      where: { id: author.id },
      select: { replyCount: true },
    })).replyCount,
    1,
  );

  const duplicateDecision = await call(`/replies/${replyA.id}`, "PATCH", {
    aiReviewStatus: "rejected_manual",
  });
  assert.equal(duplicateDecision.response.status, 400);

  const destroyed = await call(`/topics/${topic.id}?hard=1`, "DELETE");
  assert.equal(destroyed.response.status, 200, destroyed.body.message);
  assert.deepEqual(destroyed.body.data, {
    ok: true,
    hard: true,
    deletedReplies: 2,
    deletedRatings: 1,
  });
  topicId = null;
  assert.equal(await prisma.topic.findUnique({ where: { id: topic.id } }), null);
  assert.equal(
    await prisma.courseRating.findUnique({ where: { topicId: topic.id } }),
    null,
  );
  assert.equal(isGlobalPinnedTopic(topic.id), false);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({
      where: { id: responder.id },
      select: { replyCount: true },
    })).replyCount,
    0,
  );
  const updatedAuthor = await prisma.user.findUniqueOrThrow({
    where: { id: author.id },
    select: { postCount: true, replyCount: true },
  });
  assert.deepEqual(updatedAuthor, { postCount: 0, replyCount: 0 });
  const actualBoardCountAfter = await prisma.topic.count({
    where: { boardId: board.id, hidden: false },
  });
  assert.equal(
    (await prisma.board.findUniqueOrThrow({
      where: { id: board.id },
      select: { topicCount: true },
    })).topicCount,
    actualBoardCountAfter,
  );
  assert.deepEqual(
    await prisma.course.findUniqueOrThrow({
      where: { id: course.id },
      select: {
        ratingCount: true,
        avgDifficulty: true,
        avgReward: true,
        avgRecommend: true,
        avgScore: true,
      },
    }),
    {
      ratingCount: 0,
      avgDifficulty: 0,
      avgReward: 0,
      avgRecommend: 0,
      avgScore: 0,
    },
  );
});
