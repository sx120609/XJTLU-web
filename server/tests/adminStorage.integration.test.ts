import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "admin-storage-integration-secret";

test("admin storage routes protect secrets and destructive actions", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { prisma } = await import("../src/prisma");
  const { loadStorageConfig } = await import(
    "../src/services/storageConfig"
  );
  const { signToken } = await import("../src/utils/jwt");

  const storageWhere = {
    OR: [
      { key: { startsWith: "storage." } },
      { key: { startsWith: "filestore." } },
    ],
  };
  const originalSettings = await prisma.siteSetting.findMany({
    where: storageWhere,
    select: { key: true, value: true },
  });
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const [admin, user] = await Promise.all([
    prisma.user.create({
      data: {
        username: `admin_storage_admin_${suffix}`,
        passwordHash: "not-used",
        nickname: "存储集成管理员",
        role: "admin",
      },
    }),
    prisma.user.create({
      data: {
        username: `admin_storage_user_${suffix}`,
        passwordHash: "not-used",
        nickname: "存储集成用户",
      },
    }),
  ]);
  await Promise.all([
    prisma.siteSetting.upsert({
      where: { key: "storage.onedriveCn.clientSecret" },
      create: {
        key: "storage.onedriveCn.clientSecret",
        value: `secret-${suffix}`,
      },
      update: { value: `secret-${suffix}` },
    }),
    prisma.siteSetting.upsert({
      where: { key: "storage.onedriveCn.refreshToken" },
      create: {
        key: "storage.onedriveCn.refreshToken",
        value: `refresh-${suffix}`,
      },
      update: { value: `refresh-${suffix}` },
    }),
  ]);
  await loadStorageConfig();

  t.after(async () => {
    await prisma.adminActionLog.deleteMany({
      where: {
        actorId: admin.id,
        targetType: "media-storage",
      },
    });
    await prisma.siteSetting.deleteMany({ where: storageWhere });
    if (originalSettings.length) {
      await prisma.siteSetting.createMany({ data: originalSettings });
    }
    await loadStorageConfig();
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
  t.after(() => new Promise<void>((resolve) => {
    server.close(() => resolve());
  }));
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

  async function request(
    path: string,
    token: string,
    method = "GET",
    payload?: unknown,
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
      data: Record<string, unknown> | null;
      message: string;
    };
    return { response, body };
  }

  const forbidden = await request("/media-storage", userToken);
  assert.equal(forbidden.response.status, 403);

  const configResponse = await request("/media-storage", adminToken);
  assert.equal(configResponse.response.status, 200);
  assert.equal(
    Object.hasOwn(
      configResponse.body.data ?? {},
      "oneDriveChinaClientSecret",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      configResponse.body.data ?? {},
      "oneDriveChinaRefreshToken",
    ),
    false,
  );
  assert.equal(
    configResponse.body.data?.oneDriveChinaClientSecretConfigured,
    true,
  );
  assert.equal(
    configResponse.body.data?.oneDriveChinaRefreshTokenConfigured,
    true,
  );

  const emptyPatch = await request(
    "/media-storage",
    adminToken,
    "PATCH",
    {},
  );
  assert.equal(emptyPatch.response.status, 400);

  const insecureSharePoint = await request(
    "/media-storage",
    adminToken,
    "PATCH",
    {
      oneDriveChinaSharepointUrl:
        "http://tenant.sharepoint.cn/sites/media",
    },
  );
  assert.equal(insecureSharePoint.response.status, 400);

  const missingCleanupConfirmation = await request(
    "/media-storage/cleanup-local",
    adminToken,
    "POST",
    {},
  );
  assert.equal(missingCleanupConfirmation.response.status, 400);
});
