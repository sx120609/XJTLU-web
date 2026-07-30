import assert from "node:assert/strict";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import test from "node:test";
import { adminSystemRouter } from "../src/routes/admin/system";
import {
  adminJwxtAgentConfigSchema,
  getAdminJwxtAgentSnapshot,
  issueAdminJwxtAgentToken,
} from "../src/services/adminSystemService";
import {
  databaseRestoreUploadAccept,
  databaseRestoreUploadLimitBytes,
  isAcceptedDatabaseRestoreFileName,
} from "../src/services/databaseBackup";

function hasHttpStatus(status: number) {
  return (error: unknown) => (
    typeof error === "object"
    && error !== null
    && "status" in error
    && (error as { status?: unknown }).status === status
  );
}

test("admin system schemas and service permissions stay strict", () => {
  const valid = {
    localJwxtEnabled: true,
    localJwxtWeight: 10,
    crawlAgentId: "",
    agents: [{
      id: "agent-1",
      name: "Agent 1",
      token: "x".repeat(32),
      enabled: true,
      jwxtEnabled: true,
      crawlEnabled: false,
      weight: 10,
      maxConcurrent: 4,
    }],
  };
  assert.deepEqual(adminJwxtAgentConfigSchema.parse(valid), valid);
  assert.equal(
    adminJwxtAgentConfigSchema.safeParse({
      ...valid,
      agents: [{ ...valid.agents[0], tokenConfigured: true }],
    }).success,
    false,
  );
  assert.equal(
    adminJwxtAgentConfigSchema.safeParse({
      ...valid,
      localJwxtWeight: 0,
    }).success,
    false,
  );
  assert.throws(
    () => getAdminJwxtAgentSnapshot("mod"),
    hasHttpStatus(403),
  );
  assert.throws(
    () => issueAdminJwxtAgentToken("user"),
    hasHttpStatus(403),
  );
});

test("database restore uploads share one explicit extension and size contract", () => {
  assert.equal(databaseRestoreUploadAccept(), ".dump,.backup,.tar");
  assert.equal(databaseRestoreUploadLimitBytes(), 2 * 1024 * 1024 * 1024);
  assert.equal(isAcceptedDatabaseRestoreFileName("backup.dump"), true);
  assert.equal(isAcceptedDatabaseRestoreFileName("BACKUP.TAR"), true);
  assert.equal(isAcceptedDatabaseRestoreFileName("../safe.backup"), true);
  assert.equal(isAcceptedDatabaseRestoreFileName("backup.sql"), false);
  assert.equal(isAcceptedDatabaseRestoreFileName("backup.dump.exe"), false);
  assert.equal(isAcceptedDatabaseRestoreFileName(""), false);
});

test("admin system routes isolate upload effects and typed failure mapping", () => {
  const route = readFileSync(
    new URL("../src/routes/admin/system.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../src/services/databaseBackup.ts", import.meta.url),
    "utf8",
  );
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminSystemRouter);
  assert.match(route, /adminSystemRouter\.use\(adminOnly\)/);
  assert.match(route, /mkdtemp\(path\.join\(tmpdir\(\), RESTORE_UPLOAD_PREFIX\)\)/);
  assert.match(route, /isAcceptedDatabaseRestoreFileName\(file\.originalname/);
  assert.match(route, /restoreUploadDirectories = new WeakMap/);
  assert.match(route, /cleanupDatabaseRestoreUploadDirectory\(uploadDirectory\)/);
  assert.match(route, /path\.dirname\(uploadDirectory\) === resolvedTempRoot/);
  assert.match(route, /DatabaseRestoreBusy/);
  assert.match(route, /error\.failureCode === "database-unavailable"/);
  assert.doesNotMatch(route, /mkdirSync/);
  assert.match(service, /cleanupDatabaseBackupSnapshot\(\{/);
  assert.match(service, /finally \{\s*endDatabaseMaintenance\(\)/);
  assert.match(adminIndex, /adminRouter\.use\("\/", adminSystemRouter\)/);
  assert.doesNotMatch(
    adminIndex,
    /adminRouter\.(get|post|patch)\(\s*"\/(?:jwxt-agents|system\/health|database\/)/,
  );
});

test("database restore upload rejects unsupported files without leaving temp directories", async (t) => {
  const express = (await import("express")).default;
  const { errorHandler } = await import("../src/middleware/error");
  const before = new Set(
    readdirSync(tmpdir()).filter((name) => name.startsWith("xjtlu-web-db-restore-")),
  );
  const app = express();
  app.use((req, _res, next) => {
    req.user = {
      userId: 1,
      studentId: "admin-system-test",
      role: "admin",
      campus: "",
    };
    next();
  });
  app.use(adminSystemRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const unsupported = new FormData();
  unsupported.append(
    "file",
    new Blob(["not a backup"], { type: "text/plain" }),
    "database.sql",
  );
  const unsupportedResponse = await fetch(`${baseUrl}/database/restore`, {
    method: "POST",
    headers: { "Accept-Language": "zh-CN" },
    body: unsupported,
  });
  assert.equal(unsupportedResponse.status, 400);
  assert.match(JSON.stringify(await unsupportedResponse.json()), /扩展名不受支持/);

  const wrongField = new FormData();
  wrongField.append(
    "backup",
    new Blob(["not a backup"], { type: "application/octet-stream" }),
    "database.dump",
  );
  const wrongFieldResponse = await fetch(`${baseUrl}/database/restore`, {
    method: "POST",
    headers: { "Accept-Language": "zh-CN" },
    body: wrongField,
  });
  assert.equal(wrongFieldResponse.status, 400);
  assert.match(JSON.stringify(await wrongFieldResponse.json()), /字段必须为 file/);

  const after = new Set(
    readdirSync(tmpdir()).filter((name) => name.startsWith("xjtlu-web-db-restore-")),
  );
  assert.deepEqual(after, before);
});
