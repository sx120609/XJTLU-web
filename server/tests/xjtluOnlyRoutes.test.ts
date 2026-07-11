import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "xjtlu-only-route-test-secret";

test("XJTLU-only server does not expose CPU JWXT routes or course sync", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken, verifyToken } = await import("../src/utils/jwt");
  const jsonwebtoken = (await import("jsonwebtoken")).default;

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const legacyJwxt = await fetch(`${baseUrl}/api/jwxt/status`);
  assert.equal(legacyJwxt.status, 404);

  const legacySsoBegin = await fetch(`${baseUrl}/api/auth/sso-begin`, { method: "POST" });
  assert.equal(legacySsoBegin.status, 404);
  const legacySsoLogin = await fetch(`${baseUrl}/api/auth/sso-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "legacy", password: "must-not-forward" }),
  });
  assert.equal(legacySsoLogin.status, 404);

  const unscopedXjtluLogin = await fetch(`${baseUrl}/api/auth/xjtlu-sso-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingId: "a".repeat(48), username: "student.name24", password: "test" }),
  });
  assert.equal(unscopedXjtluLogin.status, 400);

  const siteToken = signToken({ userId: 1, studentId: "student.name24", role: "user", campus: "" });
  const courseSync = await fetch(`${baseUrl}/api/courses/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${siteToken}` },
  });
  assert.equal(courseSync.status, 501);
  const body = await courseSync.json() as { message?: string };
  assert.match(body.message ?? "", /XJTLU 教务课程同步尚未接入/);

  const legacyToken = jsonwebtoken.sign(
    { userId: 1, studentId: "legacy", role: "user", campus: "" },
    process.env.JWT_SECRET!,
  );
  assert.throws(() => verifyToken(legacyToken));

  const filestoreAdmin = await readFile(new URL("../filestore/public/admin.js", import.meta.url), "utf8");
  assert.doesNotMatch(filestoreAdmin, /xjtlu-web-token/);
  assert.match(filestoreAdmin, /X-XJTLU-Auth-Mode/);
  assert.doesNotMatch(filestoreAdmin, /cpu-web-token/);
});
