import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";

process.env.REDIS_ENABLED = "false";

test("school auth rate limits allow normal concurrent requests without lock-contention failures", async () => {
  const { __schoolAuthRateLimitTesting, enforceSchoolAuthRateLimit } = await import("../src/services/schoolAuthRateLimit");
  __schoolAuthRateLimitTesting.resetLocalBuckets();
  const req = {
    ip: "203.0.113.10",
    socket: { remoteAddress: "127.0.0.1" },
  } as Request;

  const beginResults = await Promise.allSettled(
    Array.from({ length: 10 }, () => enforceSchoolAuthRateLimit(req, "begin")),
  );
  assert.equal(beginResults.filter((result) => result.status === "fulfilled").length, 10);

  const submitResults = await Promise.allSettled(
    Array.from(
      { length: 10 },
      () => enforceSchoolAuthRateLimit(req, "submit", "student.name24"),
    ),
  );
  assert.equal(submitResults.filter((result) => result.status === "fulfilled").length, 8);
  assert.equal(submitResults.filter((result) => result.status === "rejected").length, 2);

  __schoolAuthRateLimitTesting.resetLocalBuckets();
  const sharedNatResults = await Promise.allSettled(
    Array.from(
      { length: 50 },
      (_, index) => enforceSchoolAuthRateLimit(req, "submit", `student.name${index}`),
    ),
  );
  assert.equal(sharedNatResults.filter((result) => result.status === "fulfilled").length, 50);
  __schoolAuthRateLimitTesting.resetLocalBuckets();
});

test("local rate-limit fallback has a hard cardinality bound", async () => {
  const {
    __schoolAuthRateLimitTesting,
    enforceSchoolAuthSourceRateLimit,
  } = await import("../src/services/schoolAuthRateLimit");
  __schoolAuthRateLimitTesting.resetLocalBuckets();

  for (let index = 0; index < __schoolAuthRateLimitTesting.maxLocalBuckets + 250; index += 1) {
    const req = {
      ip: `test-source-${index}`,
      socket: { remoteAddress: "127.0.0.1" },
    } as Request;
    await enforceSchoolAuthSourceRateLimit(req, "begin").catch(() => undefined);
  }

  assert.ok(
    __schoolAuthRateLimitTesting.localBucketCount() <= __schoolAuthRateLimitTesting.maxLocalBuckets,
  );
  __schoolAuthRateLimitTesting.resetLocalBuckets();
});
