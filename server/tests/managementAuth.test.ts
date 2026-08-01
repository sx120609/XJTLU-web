import assert from "node:assert/strict";
import test from "node:test";
import { verifyTotp, normalizeTotpSecret } from "../src/utils/totp";
import { isBossOnlyPermission, isKnownManagementPermission } from "../src/services/managementPermissions";
import { __managementLoginRateLimitTesting, enforceManagementLoginRateLimit } from "../src/services/managementLoginRateLimit";

test("management TOTP verification accepts the RFC 6238 SHA-1 vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "287083", 59_000), false);
});

test("management permission catalog keeps boss-only permissions separate", () => {
  assert.equal(isKnownManagementPermission("forum.review"), true);
  assert.equal(isKnownManagementPermission("management.accounts"), false);
  assert.equal(isBossOnlyPermission("management.accounts"), true);
  assert.equal(isBossOnlyPermission("forum.review"), false);
  assert.equal(normalizeTotpSecret(" GEZD-GNBV-GY3T-QO JQ "), "GEZDGNBVGY3TQOJQ");
});

test("management login throttles repeated source-account attempts", async () => {
  __managementLoginRateLimitTesting.reset();
  const req = { ip: "192.0.2.10", socket: { remoteAddress: "192.0.2.10" } } as any;
  for (let index = 0; index < 8; index += 1) {
    await enforceManagementLoginRateLimit(req, "boss_test");
  }
  await assert.rejects(
    () => enforceManagementLoginRateLimit(req, "boss_test"),
    (error: any) => error?.status === 429,
  );
  __managementLoginRateLimitTesting.reset();
});
