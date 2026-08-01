import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";

test("management user governance separates personal users and enforces capabilities", async (t) => {
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
      username: `boss_users_${suffix}`,
      passwordHash: await hashPassword("boss-test-password"),
      displayName: "BOSS test account",
      accountType: "boss",
      mfaEnabled: true,
      mfaSecretCiphertext: encryptManagementSecret(bossTotpSecret),
    },
  });
  const ownsBoss = !existingBoss;
  const user = await prisma.user.create({
    data: {
      username: `personal_${suffix}`,
      passwordHash: await hashPassword("personal-test-password"),
      nickname: "待治理个人用户",
      role: "user",
    },
  });
  const legacyStaff = await prisma.user.create({
    data: {
      username: `legacy_admin_${suffix}`,
      passwordHash: await hashPassword("legacy-staff-password"),
      nickname: "旧个人管理员",
      role: "admin",
    },
  });
  let adminId: number | null = null;
  let bossSessionId = "";
  t.after(async () => {
    if (adminId) {
      await prisma.managementAuditLog.deleteMany({
        where: {
          OR: [
            { actorId: adminId },
            { targetType: "admin_account", targetId: String(adminId) },
            { targetType: "user", targetId: { in: [String(user.id), String(legacyStaff.id)] } },
          ],
        },
      });
      await prisma.adminAccount.delete({ where: { id: adminId } });
    }
    if (bossSessionId) await revokeManagementSession(bossSessionId);
    if (ownsBoss) await prisma.adminAccount.delete({ where: { id: boss.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: legacyStaff.id } });
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

  const created = await call("/accounts", "POST", bossToken, {
    username: `admin_users_${suffix}`,
    password: "admin-users-password",
    displayName: "用户治理管理员",
  });
  assert.equal(created.response.status, 200, created.body.message);
  adminId = created.body.data.id;

  await call(`/accounts/${adminId}/permissions`, "PUT", bossToken, { permissions: ["users.read"] });
  const adminLogin = await call("/auth/login", "POST", "", { username: `admin_users_${suffix}`, password: "admin-users-password" });
  assert.equal(adminLogin.response.status, 200);
  const adminToken = adminLogin.body.data.token as string;

  const listed = await call(`/users?q=${encodeURIComponent(user.username)}&size=10`, "GET", adminToken);
  assert.equal(listed.response.status, 200, listed.body.message);
  assert.equal(listed.body.data.list.length, 1);
  assert.equal(listed.body.data.list[0].role, "user");

  const deniedUpdate = await call(`/users/${user.id}`, "PATCH", adminToken, { nickname: "不应修改" });
  assert.equal(deniedUpdate.response.status, 403);

  await call(`/accounts/${adminId}/permissions`, "PUT", bossToken, { permissions: ["users.read", "users.moderate"] });
  const refreshedAdminLogin = await call("/auth/login", "POST", "", { username: `admin_users_${suffix}`, password: "admin-users-password" });
  assert.equal(refreshedAdminLogin.response.status, 200);
  const refreshedAdminToken = refreshedAdminLogin.body.data.token as string;
  const updated = await call(`/users/${user.id}`, "PATCH", refreshedAdminToken, { nickname: "已由治理管理员修改" });
  assert.equal(updated.response.status, 200, updated.body.message);
  assert.equal(updated.body.data.nickname, "已由治理管理员修改");
  await call(`/accounts/${adminId}/permissions`, "PUT", bossToken, { permissions: ["users.read", "users.moderate", "users.sensitive"] });
  const sensitiveLogin = await call("/auth/login", "POST", "", { username: `admin_users_${suffix}`, password: "admin-users-password" });
  assert.equal(sensitiveLogin.response.status, 200);
  const sensitiveToken = sensitiveLogin.body.data.token as string;
  const legacyUpdate = await call(`/users/${legacyStaff.id}`, "PATCH", sensitiveToken, { nickname: "不应修改旧管理员" });
  assert.equal(legacyUpdate.response.status, 403);
  const legacyDelete = await call(`/users/${legacyStaff.id}`, "DELETE", sensitiveToken);
  assert.equal(legacyDelete.response.status, 403);
});
