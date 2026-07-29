import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "admin-board-integration-secret";

test("admin board routes protect system boards and preserve string references", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const admin = await prisma.user.create({
    data: {
      username: `admin_board_admin_${suffix}`,
      passwordHash: "not-used",
      nickname: "板块管理集成管理员",
      role: "admin",
    },
  });
  const groupId = `admin-board-group-${suffix}`;
  let customBoardId: number | null = null;
  t.after(async () => {
    await prisma.qqBotGroup.deleteMany({ where: { groupId } });
    if (customBoardId) {
      await prisma.topic.deleteMany({ where: { boardId: customBoardId } });
      await prisma.board.deleteMany({ where: { id: customBoardId } });
    }
    await prisma.user.deleteMany({ where: { id: admin.id } });
  });

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

  const systemBoard = await prisma.board.findUnique({
    where: { slug: "general" },
  });
  assert.ok(systemBoard, "migrated database must contain the general board");
  const protectedPatch = await call(
    `/boards/${systemBoard.id}`,
    "PATCH",
    { name: "不应被修改" },
  );
  assert.equal(protectedPatch.response.status, 400);
  const protectedDelete = await call(
    `/boards/${systemBoard.id}`,
    "DELETE",
  );
  assert.equal(protectedDelete.response.status, 400);

  const invalidId = await call(
    "/boards/not-a-number",
    "PATCH",
    { name: "invalid" },
  );
  assert.equal(invalidId.response.status, 400);
  const strictWrite = await call("/boards", "POST", {
    slug: `admin-board-${suffix}`.toLowerCase(),
    name: "严格字段测试",
    type: "normal",
    readOnly: true,
  });
  assert.equal(strictWrite.response.status, 400);

  const originalSlug = `admin-board-${suffix}`.toLowerCase();
  const renamedSlug = `${originalSlug}-renamed`;
  const created = await call("/boards", "POST", {
    slug: originalSlug,
    name: "板块管理集成测试",
    description: "可清空描述",
    icon: "🧪",
    color: "#123456",
    order: 8888,
    type: "normal",
    section: null,
    anonymousEnabled: true,
  });
  assert.equal(created.response.status, 200, created.body.message);
  const createdBoard = created.body.data as {
    id: number;
    systemManaged: boolean;
  };
  customBoardId = createdBoard.id;
  assert.equal(createdBoard.systemManaged, false);

  const duplicate = await call("/boards", "POST", {
    slug: originalSlug,
    name: "重复",
    type: "normal",
  });
  assert.equal(duplicate.response.status, 409);

  await prisma.qqBotGroup.create({
    data: {
      groupId,
      name: "板块引用迁移测试",
      defaultBoardSlug: originalSlug,
    },
  });
  const renamed = await call(`/boards/${customBoardId}`, "PATCH", {
    slug: renamedSlug,
    description: null,
    icon: null,
    color: null,
  });
  assert.equal(renamed.response.status, 200, renamed.body.message);
  assert.deepEqual(
    await prisma.board.findUniqueOrThrow({
      where: { id: customBoardId },
      select: {
        slug: true,
        description: true,
        icon: true,
        color: true,
      },
    }),
    {
      slug: renamedSlug,
      description: null,
      icon: null,
      color: null,
    },
  );
  assert.equal(
    (await prisma.qqBotGroup.findUniqueOrThrow({
      where: { groupId },
      select: { defaultBoardSlug: true },
    })).defaultBoardSlug,
    renamedSlug,
  );

  const referencedDelete = await call(
    `/boards/${customBoardId}`,
    "DELETE",
  );
  assert.equal(referencedDelete.response.status, 409);
  assert.match(referencedDelete.body.message, /QQ群默认板块配置/);

  await prisma.qqBotGroup.delete({ where: { groupId } });
  const deleted = await call(`/boards/${customBoardId}`, "DELETE");
  assert.equal(deleted.response.status, 200, deleted.body.message);
  assert.deepEqual(deleted.body.data, {
    ok: true,
    deletedBoardId: customBoardId,
  });
  assert.equal(
    await prisma.board.findUnique({ where: { id: customBoardId } }),
    null,
  );
  customBoardId = null;
});
