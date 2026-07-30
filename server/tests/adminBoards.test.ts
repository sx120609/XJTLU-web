import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminBoardRouter } from "../src/routes/admin/boards";
import {
  adminBoardCreateSchema,
  adminBoardPatchSchema,
  adminFeedPatchSchema,
  isSystemManagedBoardSlug,
} from "../src/services/adminBoardService";

test("admin board and feed schemas reject broad or empty writes", () => {
  assert.deepEqual(
    adminBoardCreateSchema.parse({
      slug: " custom-board ",
      name: " Custom ",
      description: null,
      type: "normal",
      section: "general",
    }),
    {
      slug: "custom-board",
      name: "Custom",
      description: null,
      type: "normal",
      section: "general",
    },
  );
  assert.equal(adminBoardPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminBoardPatchSchema.safeParse({
      name: "Updated",
      readOnly: true,
    }).success,
    false,
  );
  assert.deepEqual(
    adminBoardPatchSchema.parse({
      description: null,
      icon: null,
      color: null,
    }),
    {
      description: null,
      icon: null,
      color: null,
    },
  );
  assert.equal(adminFeedPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminFeedPatchSchema.safeParse({
      enabled: true,
      listUrl: "https://attacker.invalid/",
    }).success,
    false,
  );
  assert.equal(
    adminFeedPatchSchema.safeParse({ cronMinutes: 0 }).success,
    false,
  );
});

test("product-owned board slugs stay explicitly protected", () => {
  for (const slug of [
    "general",
    "wanted-demand",
    "question",
    "coursereview",
    "market",
  ]) {
    assert.equal(isSystemManagedBoardSlug(slug), true);
  }
  assert.equal(isSystemManagedBoardSlug("custom-board"), false);
});

test("board routes and crawler use isolated services and transactional ingestion", () => {
  const route = readFileSync(
    new URL("../src/routes/admin/boards.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../src/services/adminBoardService.ts", import.meta.url),
    "utf8",
  );
  const crawler = readFileSync(
    new URL("../src/services/schoolCrawler.ts", import.meta.url),
    "utf8",
  );
  const topicRoute = readFileSync(
    new URL("../src/routes/topic.ts", import.meta.url),
    "utf8",
  );
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminBoardRouter);
  assert.match(route, /adminBoardRouter\.use\(adminOnly\)/);
  assert.match(route, /positiveRouteInteger\(value\)/);
  assert.match(service, /FOR UPDATE/);
  assert.doesNotMatch(service, /tx\.qqBotConfig/);
  assert.doesNotMatch(service, /tx\.qqBotGroup/);
  assert.match(service, /withSchoolFeedSourceLock/);
  assert.match(crawler, /school-crawler:source:/);
  assert.match(crawler, /inserted = await prisma\.\$transaction/);
  assert.match(crawler, /tx\.schoolFeedItem\.create/);
  assert.match(crawler, /refreshUserReplyCount/);
  assert.match(crawler, /mutateTopicGlobalPin/);
  assert.doesNotMatch(
    crawler,
    /data: \{ enabled: false \}/,
  );
  assert.match(topicRoute, /FOR KEY SHARE/);
  assert.match(adminIndex, /adminRouter\.use\("\/", adminBoardRouter\)/);
  assert.doesNotMatch(
    adminIndex,
    /adminRouter\.(get|post|patch|delete)\(\s*"\/(?:boards|feeds)/,
  );
});
