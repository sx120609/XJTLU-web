import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminContentRouter } from "../src/routes/admin/content";
import { escapeWeiwallAuthHtml } from "../src/routes/weiwallAuth";
import {
  adminAnnouncementCreateSchema,
  adminAnnouncementPatchSchema,
  adminAnnouncementSyncPatchSchema,
  adminWeiwallAuthStatusParamsSchema,
  adminWeiwallPatchSchema,
  isSafeAnnouncementLink,
} from "../src/services/adminContentService";
import {
  normalizeNotificationTargetClient,
  notificationVisibleToClient,
} from "../src/services/notificationTargeting";
import {
  normalizeWeiwallBaseUrl,
  normalizeWeiwallCallbackOrigin,
} from "../src/services/weiwallSync";

test("admin content schemas reject empty, broad, or unsafe writes", () => {
  assert.equal(adminWeiwallPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminWeiwallPatchSchema.safeParse({
      token: "new-token",
      clearToken: true,
    }).success,
    false,
  );
  assert.equal(
    adminWeiwallPatchSchema.safeParse({
      baseUrl: "http://s.weiwall.com",
    }).success,
    false,
  );
  assert.equal(adminAnnouncementSyncPatchSchema.safeParse({}).success, false);
  assert.equal(adminAnnouncementPatchSchema.safeParse({}).success, false);
  assert.equal(
    adminAnnouncementCreateSchema.safeParse({
      title: "站务通知",
      content: "内容",
      link: "javascript:alert(1)",
    }).success,
    false,
  );
  assert.equal(
    adminAnnouncementCreateSchema.safeParse({
      title: "站务通知",
      content: "内容",
      targetClient: [],
    }).success,
    false,
  );
  assert.equal(
    adminAnnouncementCreateSchema.safeParse({
      title: "站务通知",
      content: "内容",
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    adminWeiwallAuthStatusParamsSchema.safeParse({
      flowId: "not-a-uuid",
    }).success,
    false,
  );
});

test("notification targeting is canonical and malformed targets fail closed", () => {
  assert.equal(
    normalizeNotificationTargetClient(["web", "ios", "web"]),
    "ios,web",
  );
  assert.equal(
    normalizeNotificationTargetClient(["ios", "android", "harmony", "web"]),
    null,
  );
  assert.throws(
    () => normalizeNotificationTargetClient(["all", "web"]),
    /不能与指定平台同时选择/,
  );
  assert.equal(
    notificationVisibleToClient({ targetClient: "ios,web" }, "web"),
    true,
  );
  assert.equal(
    notificationVisibleToClient({ targetClient: "ios,invalid" }, "ios"),
    false,
  );
  assert.equal(
    notificationVisibleToClient({ targetClient: "web" }, "unknown"),
    true,
  );
});

test("external links and auth output stay on safe URL and HTML boundaries", () => {
  assert.equal(isSafeAnnouncementLink("/forum/topic/1"), true);
  assert.equal(isSafeAnnouncementLink("https://example.com/news"), true);
  assert.equal(isSafeAnnouncementLink("//attacker.invalid/path"), false);
  assert.equal(isSafeAnnouncementLink("data:text/html,boom"), false);
  assert.equal(
    normalizeWeiwallBaseUrl("https://s.weiwall.com/some/path"),
    "https://s.weiwall.com",
  );
  assert.equal(
    normalizeWeiwallCallbackOrigin("https://cpu.example/admin?tab=weiwall"),
    "https://cpu.example",
  );
  assert.throws(
    () => normalizeWeiwallBaseUrl("http://s.weiwall.com"),
    /HTTPS/,
  );
  assert.equal(
    escapeWeiwallAuthHtml("<script>alert('x')</script>"),
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;",
  );
});

test("content routes delegate to isolated services and shared locks", () => {
  const route = readFileSync(
    new URL("../src/routes/admin/content.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../src/services/adminContentService.ts", import.meta.url),
    "utf8",
  );
  const sync = readFileSync(
    new URL("../src/services/xjtluAnnouncementSync.ts", import.meta.url),
    "utf8",
  );
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );
  const home = readFileSync(
    new URL("../src/routes/home.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminContentRouter);
  assert.match(route, /adminContentRouter\.use\(adminOnly\)/);
  assert.match(route, /positiveRouteInteger\(value\)/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /notification\.delete/);
  assert.match(service, /category !== "system"/);
  assert.match(sync, /SYNC_LOCK_NAME/);
  assert.match(sync, /syncXjtluAnnouncementsUnlocked/);
  assert.match(home, /notificationTargetClientWhere/);
  assert.match(adminIndex, /adminRouter\.use\("\/", adminContentRouter\)/);
  assert.doesNotMatch(
    adminIndex,
    /adminRouter\.(get|post|patch|delete)\(\s*"\/(?:weiwall-sync|announcement-sync|announcements)/,
  );
});
