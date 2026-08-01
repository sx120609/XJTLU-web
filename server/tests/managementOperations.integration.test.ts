import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";

test("management operations use capability checks and independent audit actors", async (t) => {
  const { createApp } = await import("../src/app");
  const { prisma } = await import("../src/prisma");
  const { hashPassword } = await import("../src/utils/password");
  const suffix = `${Date.now().toString(36)}-${process.pid}`;
  const slug = `manage-${suffix}`;

  const admin = await prisma.adminAccount.create({
    data: {
      username: `operations_admin_${suffix}`,
      passwordHash: await hashPassword("operations-admin-password"),
      displayName: "操作测试管理员",
      accountType: "admin",
    },
  });
  t.after(async () => {
    await prisma.managementAuditLog.deleteMany({ where: { actorId: admin.id } });
    await prisma.board.deleteMany({ where: { slug } });
    await prisma.adminAccountPermission.deleteMany({ where: { adminAccountId: admin.id } });
    await prisma.adminSession.deleteMany({ where: { adminAccountId: admin.id } });
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
    password: "operations-admin-password",
  });
  assert.equal(login.response.status, 200, login.body.message);
  const token = login.body.data.token as string;

  const denied = await call("/system/health", "GET", token);
  assert.equal(denied.response.status, 403);

  await prisma.adminAccountPermission.createMany({
    data: [
      { adminAccountId: admin.id, permissionCode: "content.manage" },
      { adminAccountId: admin.id, permissionCode: "system.manage" },
    ],
  });

  const health = await call("/system/health", "GET", token);
  assert.equal(health.response.status, 200, health.body.message);
  assert.equal(typeof health.body.data.database.ok, "boolean");

  const created = await call("/boards", "POST", token, {
    slug,
    name: "管理操作测试板块",
    description: "独立管理身份创建",
    type: "normal",
    section: "general",
  });
  assert.equal(created.response.status, 200, created.body.message);
  assert.equal(created.body.data.slug, slug);

  const listed = await call("/boards", "GET", token);
  assert.equal(listed.response.status, 200, listed.body.message);
  assert.equal(listed.body.data.some((row: { slug: string }) => row.slug === slug), true);

  const actions = await prisma.managementAuditLog.findMany({
    where: { actorId: admin.id },
    select: { action: true },
  });
  assert.equal(actions.some((row) => row.action === "management.board.create"), true);
});
