import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminForumRouter } from "../src/routes/admin/forum";
import {
  adminForumMediaPatchSchema,
  adminForumVideoListQuerySchema,
  adminReplyPatchSchema,
  adminReviewTargetParamsSchema,
  adminTopicDeleteQuerySchema,
  adminTopicListQuerySchema,
  adminTopicPatchSchema,
} from "../src/services/adminForumService";
import { forumTopicLockKey } from "../src/services/forumTopicLockService";

test("admin forum schemas keep list, moderation, and delete inputs strict", () => {
  assert.deepEqual(
    adminTopicListQuerySchema.parse({
      q: " review ",
      hidden: "0",
      page: "2",
      size: "30",
      reviewStatus: "manual_requested",
    }),
    {
      q: "review",
      hidden: false,
      page: 2,
      size: 30,
      reviewStatus: "manual_requested",
    },
  );
  assert.equal(
    adminTopicListQuerySchema.safeParse({ page: "NaN" }).success,
    false,
  );
  assert.equal(
    adminTopicListQuerySchema.safeParse({ unexpected: "field" }).success,
    false,
  );
  assert.equal(adminTopicPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminTopicPatchSchema.safeParse({
      hidden: true,
      authorId: 1,
    }).success,
    false,
  );
  assert.equal(
    adminReplyPatchSchema.safeParse({ manualReviewNote: "missing status" }).success,
    false,
  );
  assert.equal(
    adminForumMediaPatchSchema.safeParse({
      status: "pending",
    }).success,
    false,
  );
  assert.deepEqual(
    adminReviewTargetParamsSchema.parse({ kind: "reply", id: "42" }),
    { kind: "reply", id: 42 },
  );
  assert.equal(
    adminReviewTargetParamsSchema.safeParse({ kind: "post", id: "42" }).success,
    false,
  );
  assert.deepEqual(
    adminTopicDeleteQuerySchema.parse({ hard: "true" }),
    { hard: true },
  );
  assert.equal(
    adminTopicDeleteQuerySchema.safeParse({ hard: "yes" }).success,
    false,
  );
  assert.deepEqual(
    adminForumVideoListQuerySchema.parse({ status: "error" }),
    { status: "error", page: 1, size: 20 },
  );
});

test("forum topic lock keys are deterministic and topic-scoped", () => {
  assert.equal(forumTopicLockKey(7), forumTopicLockKey(7));
  assert.notEqual(forumTopicLockKey(7), forumTopicLockKey(8));
  assert.ok(forumTopicLockKey(7) > BigInt(2 ** 32));
});

test("admin forum routes delegate to transactional services without legacy handlers", () => {
  const route = readFileSync(
    new URL("../src/routes/admin/forum.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../src/services/adminForumService.ts", import.meta.url),
    "utf8",
  );
  const replyRoute = readFileSync(
    new URL("../src/routes/reply.ts", import.meta.url),
    "utf8",
  );
  const settings = readFileSync(
    new URL("../src/services/siteSettings.ts", import.meta.url),
    "utf8",
  );
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminForumRouter);
  assert.match(route, /validate\(adminTopicListQuerySchema, "query"\)/);
  assert.match(route, /positiveRouteInteger\(value\)/);
  assert.match(service, /acquireForumTopicLock\(tx, topicId\)/);
  assert.match(service, /refreshTopicReplyStats\(reply\.topicId, tx\)/);
  assert.match(service, /tx\.courseRating\.deleteMany/);
  assert.match(service, /refreshCourseRatingAggregates/);
  assert.match(service, /manualReviewedById: actor\.userId/);
  assert.match(replyRoute, /acquireForumTopicLock\(tx, topicId\)/);
  assert.match(replyRoute, /orderBy: \[\{ floor: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(settings, /GLOBAL_PINNED_TOPICS_LOCK_KEY/);
  assert.match(settings, /mutateTopicGlobalPin/);
  assert.match(adminIndex, /adminRouter\.use\("\/", adminForumRouter\)/);
  assert.doesNotMatch(
    adminIndex,
    /adminRouter\.(get|patch|delete)\(\s*"\/(?:topics|replies|review-targets|forum-images|forum-videos)/,
  );
});
