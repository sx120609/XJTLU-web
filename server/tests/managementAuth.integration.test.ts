import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";

test("management login is independent from the personal User token", async (t) => {
  const { createApp } = await import("../src/app");
  const { prisma } = await import("../src/prisma");
  const { hashPassword } = await import("../src/utils/password");
  const { signToken } = await import("../src/utils/jwt");

  const username = `manage_test_${Date.now().toString(36)}`;
  const account = await prisma.adminAccount.create({
    data: {
      username,
      passwordHash: await hashPassword("management-test-password"),
      displayName: "管理认证测试账号",
      accountType: "admin",
      status: "active",
      mfaEnabled: false,
    },
  });
  t.after(async () => {
    await prisma.adminAccount.delete({ where: { id: account.id } });
  });

  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/manage/auth`;

  const personalTokenResponse = await fetch(`${baseUrl}/me`, {
    headers: {
      Authorization: `Bearer ${signToken({ userId: account.id, studentId: username, role: "admin", campus: "" })}`,
    },
  });
  assert.equal(personalTokenResponse.status, 401);

  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "zh-CN" },
    body: JSON.stringify({ username, password: "management-test-password" }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = await loginResponse.json() as { data: { token: string; sessionId: string } };
  assert.ok(loginBody.data.token);
  assert.ok(loginBody.data.sessionId);

  const meResponse = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${loginBody.data.token}` },
  });
  assert.equal(meResponse.status, 200);
  const meBody = await meResponse.json() as { data: { adminAccountId: number; accountType: string } };
  assert.equal(meBody.data.adminAccountId, account.id);
  assert.equal(meBody.data.accountType, "admin");

  const logoutResponse = await fetch(`${baseUrl}/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loginBody.data.token}` },
  });
  assert.equal(logoutResponse.status, 200);

  const expiredResponse = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${loginBody.data.token}` },
  });
  assert.equal(expiredResponse.status, 401);
});
