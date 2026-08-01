import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";

test("BOSS can create administrators and replace their permissions", async (t) => {
  const { createApp } = await import("../src/app");
  const { prisma } = await import("../src/prisma");
  const { hashPassword } = await import("../src/utils/password");
  const { encryptManagementSecret } = await import("../src/utils/managementCrypto");
  const { issueManagementSession, revokeManagementSession } = await import("../src/services/managementAuthService");

  const suffix = Date.now().toString(36);
  const bossTotpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const existingBoss = await prisma.adminAccount.findFirst({ where: { accountType: "boss", status: "active" } });
  const boss = existingBoss ?? await prisma.adminAccount.create({
    data: {
      username: `boss_test_${suffix}`,
      passwordHash: await hashPassword("boss-test-password"),
      displayName: "BOSS test account",
      accountType: "boss",
      status: "active",
      mfaEnabled: true,
      mfaSecretCiphertext: encryptManagementSecret(bossTotpSecret),
    },
  });
  const ownsBoss = !existingBoss;
  let adminId: number | null = null;
  let bossSessionId = "";
  t.after(async () => {
    if (adminId) {
      await prisma.managementAuditLog.deleteMany({
        where: {
          OR: [
            { actorId: adminId },
            { targetType: "admin_account", targetId: String(adminId) },
          ],
        },
      });
      await prisma.adminAccount.delete({ where: { id: adminId } });
    }
    if (bossSessionId) await revokeManagementSession(bossSessionId);
    if (ownsBoss) await prisma.adminAccount.delete({ where: { id: boss.id } });
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

  const bossSession = await issueManagementSession(boss, { ip: "127.0.0.1", get: () => "" } as any);
  bossSessionId = bossSession.sessionId;
  const bossToken = bossSession.token;

  const catalog = await call("/permissions", "GET", bossToken);
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.body.data.permissions.some((row: any) => row.code === "forum.review"));
  assert.ok(catalog.body.data.bossOnly.includes("management.accounts"));

  const created = await call("/accounts", "POST", bossToken, {
    username: `admin_test_${suffix}`,
    password: "admin-test-password",
    displayName: "审核管理员",
  });
  assert.equal(created.response.status, 200, created.body.message);
  adminId = created.body.data.id;
  assert.deepEqual(created.body.data.permissions, []);

  const permissions = await call(`/accounts/${adminId}/permissions`, "PUT", bossToken, {
    permissions: ["forum.review", "learning.review"],
  });
  assert.equal(permissions.response.status, 200, permissions.body.message);
  assert.deepEqual(permissions.body.data.permissions, ["forum.review", "learning.review"]);

  const listed = await call("/accounts", "GET", bossToken);
  assert.equal(listed.response.status, 200);
  const row = listed.body.data.find((item: any) => item.id === adminId);
  assert.deepEqual(row.permissions, ["forum.review", "learning.review"]);

  const adminLogin = await call("/auth/login", "POST", "", {
    username: `admin_test_${suffix}`,
    password: "admin-test-password",
  });
  assert.equal(adminLogin.response.status, 200);
  const adminToken = adminLogin.body.data.token as string;
  const denied = await call("/accounts", "GET", adminToken);
  assert.equal(denied.response.status, 403);
  const adminCannotGrant = await call(`/accounts/${adminId}/permissions`, "PUT", adminToken, { permissions: ["system.manage"] });
  assert.equal(adminCannotGrant.response.status, 403);
  const unknownPermission = await call(`/accounts/${adminId}/permissions`, "PUT", bossToken, { permissions: ["management.accounts"] });
  assert.equal(unknownPermission.response.status, 400);
  const protectedBoss = await call(`/accounts/${boss.id}`, "PATCH", bossToken, { displayName: "不应被修改" });
  assert.equal(protectedBoss.response.status, 403);

  const audit = await call("/audit", "GET", bossToken);
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.data.list.some((item: any) => item.action === "management.account.permissions_replace"));
});
