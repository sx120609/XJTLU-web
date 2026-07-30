import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminUserRouter } from "../src/routes/admin/users";
import {
  adminUserCreateSchema,
  adminUserListQuerySchema,
  adminUserPasswordSchema,
  adminUserPatchSchema,
  adminUserPatchRemovesUsableAdmin,
  assertAdminUserPatchAllowed,
  protectedAdminUserDependencyLabels,
} from "../src/services/adminUserService";

function hasHttpStatus(status: number) {
  return (error: unknown) => (
    typeof error === "object"
    && error !== null
    && "status" in error
    && (error as { status?: unknown }).status === status
  );
}

test("admin user schemas keep list and write boundaries strict", () => {
  assert.deepEqual(
    adminUserListQuerySchema.parse({
      page: "2",
      size: "40",
      forumEnabled: "1",
      sort: "id-asc",
    }),
    {
      q: "",
      page: 2,
      size: 40,
      forumEnabled: true,
      sort: "id-asc",
    },
  );
  assert.equal(
    adminUserListQuerySchema.safeParse({ role: "owner" }).success,
    false,
  );
  assert.equal(
    adminUserListQuerySchema.safeParse({ page: "NaN" }).success,
    false,
  );
  assert.equal(
    adminUserListQuerySchema.safeParse({ unexpected: "field" }).success,
    false,
  );
  assert.equal(adminUserPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminUserPatchSchema.safeParse({ status: "active", password: "leak" }).success,
    false,
  );
  assert.deepEqual(
    adminUserCreateSchema.parse({
      username: " admin_2 ",
      password: "secret12",
      nickname: " Staff ",
    }),
    {
      username: "admin_2",
      password: "secret12",
      nickname: "Staff",
      role: "user",
    },
  );
  assert.equal(
    adminUserPasswordSchema.safeParse({
      newPassword: "secret12",
      studentSso: false,
    }).success,
    false,
  );
});

test("admin user permission rules protect staff and the current account", () => {
  assert.doesNotThrow(() => assertAdminUserPatchAllowed(
    { userId: 10, role: "mod" },
    { id: 20, role: "user" },
    { nickname: "Renamed" },
  ));

  assert.throws(
    () => assertAdminUserPatchAllowed(
      { userId: 10, role: "mod" },
      { id: 20, role: "admin" },
      { status: "banned" },
    ),
    hasHttpStatus(403),
  );
  assert.throws(
    () => assertAdminUserPatchAllowed(
      { userId: 10, role: "mod" },
      { id: 20, role: "user" },
      { anonymousCredits: 10 },
    ),
    hasHttpStatus(403),
  );
  assert.throws(
    () => assertAdminUserPatchAllowed(
      { userId: 10, role: "admin" },
      { id: 10, role: "admin" },
      { status: "banned" },
    ),
    hasHttpStatus(400),
  );

  assert.equal(
    adminUserPatchRemovesUsableAdmin(
      { role: "admin", status: "active" },
      { status: "banned" },
    ),
    true,
  );
  assert.equal(
    adminUserPatchRemovesUsableAdmin(
      { role: "admin", status: "active" },
      { role: "mod" },
    ),
    true,
  );
  assert.equal(
    adminUserPatchRemovesUsableAdmin(
      { role: "admin", status: "active" },
      { status: "muted" },
    ),
    false,
  );
  assert.equal(
    adminUserPatchRemovesUsableAdmin(
      { role: "admin", status: "banned" },
      { role: "user" },
    ),
    false,
  );
  assert.throws(
    () => assertAdminUserPatchAllowed(
      { userId: 10, role: "admin" },
      { id: 10, role: "admin" },
      { role: "user" },
    ),
    hasHttpStatus(400),
  );
});

test("protected user dependencies produce actionable deletion blockers", () => {
  assert.deepEqual(
    protectedAdminUserDependencyLabels({
      feedSources: 1,
      sponsorOrders: 0,
      promotionOrders: 0,
      marketOrders: 2,
      marketRefunds: 0,
      marketSettlements: 0,
      marketReports: 0,
      marketViolations: 0,
      marketAppeals: 0,
      learningMaterialVersions: 3,
      learningMaterialSupportTickets: 0,
      ownedItemWantedResponses: 4,
    }),
    [
      "公告抓取源 1 个",
      "市集订单 2 笔",
      "学习资料版本 3 个",
      "商品关联求购响应 4 个",
    ],
  );
});

test("admin user router delegates locked service operations with safe ids", () => {
  const route = readFileSync(
    new URL("../src/routes/admin/users.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../src/services/adminUserService.ts", import.meta.url),
    "utf8",
  );
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminUserRouter);
  assert.match(route, /positiveRouteInteger\(value\)/);
  assert.match(route, /validate\(adminUserListQuerySchema, "query"\)/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /不能移除或封禁最后一个可用的超级管理员/);
  assert.match(service, /protectedAdminUserDependencies\(tx, userId\)/);
  assert.match(service, /affectedReplyAuthors/);
  assert.match(service, /tx\.user\.updateMany/);
  assert.doesNotMatch(service, /tx\.messageSetting\.create/);
  assert.match(adminIndex, /adminRouter\.use\("\/", adminUserRouter\)/);
  assert.doesNotMatch(
    adminIndex,
    /adminRouter\.(get|post|patch|delete)\(\s*"\/users/,
  );
});
