import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminOverviewRouter } from "../src/routes/admin/overview";
import { adminSiteRouter } from "../src/routes/admin/site";
import {
  adminAiReviewLogQuerySchema,
  adminFeaturePatchSchema,
  adminSiteConfigPatchSchema,
  serializeAdminSiteConfig,
} from "../src/services/adminSiteService";
import {
  normalizeSiteLogoUrl,
  normalizeSiteOrigin,
} from "../src/services/siteSettings";

test("site settings schemas reject empty, mixed, unsafe, or inconsistent writes", () => {
  assert.equal(adminSiteConfigPatchSchema.safeParse({}).success, false);
  assert.equal(adminFeaturePatchSchema.safeParse({}).success, false);
  assert.equal(
    adminFeaturePatchSchema.safeParse({
      forum: true,
      unexpected: false,
    }).success,
    false,
  );
  assert.equal(
    adminSiteConfigPatchSchema.safeParse({
      aiReviewApiKey: "new-key",
      clearAiReviewApiKey: true,
    }).success,
    false,
  );
  assert.equal(
    adminSiteConfigPatchSchema.safeParse({
      aiReviewApiUrl: "file:///etc/passwd",
    }).success,
    false,
  );
  assert.equal(
    adminSiteConfigPatchSchema.safeParse({
      anonymousTiers: [
        { reputation: 30, quota: 1 },
        { reputation: 20, quota: 2 },
        { reputation: 90, quota: 3 },
        { reputation: 120, quota: 4 },
      ],
    }).success,
    false,
  );
  assert.equal(
    adminSiteConfigPatchSchema.safeParse({
      reputationLevels: [
        { level: 1, name: "一", minReputation: 0 },
        { level: 2, name: "二", minReputation: 30 },
        { level: 3, name: "三", minReputation: 60 },
        { level: 4, name: "四", minReputation: 60 },
        { level: 5, name: "五", minReputation: 120 },
      ],
    }).success,
    false,
  );
  assert.equal(
    adminAiReviewLogQuerySchema.safeParse({
      kind: "unknown",
    }).success,
    false,
  );
});

test("site identity URLs reject embedded credentials", () => {
  assert.throws(
    () => normalizeSiteOrigin("https://user:pass@example.com"),
    /http 或 https/,
  );
  assert.throws(
    () => normalizeSiteLogoUrl("https://user:pass@example.com/logo.png"),
    /Logo 地址格式不正确/,
  );
  assert.equal(
    normalizeSiteOrigin("https://example.com/some/path"),
    "https://example.com",
  );
});

test("admin site serialization never exposes AI API keys", () => {
  const config = serializeAdminSiteConfig();
  assert.equal(config.aiReviewApiKey, "");
  assert.equal(config.qqGroupAdReviewApiKey, "");
  assert.equal(config.imageReviewApiKey, "");
  assert.equal(config.videoReviewApiKey, "");
  assert.equal(typeof config.hasAiReviewApiKey, "boolean");
  assert.equal(typeof config.aiReviewApiKeyMasked, "string");
});

test("overview and site routes delegate to isolated services", () => {
  const siteRoute = readFileSync(
    new URL("../src/routes/admin/site.ts", import.meta.url),
    "utf8",
  );
  const siteService = readFileSync(
    new URL("../src/services/adminSiteService.ts", import.meta.url),
    "utf8",
  );
  const overviewService = readFileSync(
    new URL("../src/services/adminOverviewService.ts", import.meta.url),
    "utf8",
  );
  const settingsService = readFileSync(
    new URL("../src/services/siteSettings.ts", import.meta.url),
    "utf8",
  );
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminSiteRouter);
  assert.ok(adminOverviewRouter);
  assert.match(siteRoute, /adminSiteRouter\.use\(adminOnly\)/);
  assert.match(siteService, /runWithDistributedLock/);
  assert.match(siteService, /aiReviewApiKey: ""/);
  assert.match(siteService, /Prisma\.AiReviewLogWhereInput/);
  assert.match(overviewService, /\["admin", "mod"\]/);
  assert.match(settingsService, /export async function setFeatures/);
  assert.match(
    settingsService,
    /export async function setSiteIdentityConfig/,
  );
  assert.match(adminIndex, /adminRouter\.use\("\/", adminSiteRouter\)/);
  assert.match(
    adminIndex,
    /adminRouter\.use\("\/", adminOverviewRouter\)/,
  );
  assert.doesNotMatch(
    adminIndex,
    /adminRouter\.(get|post|patch)\(\s*"\/(?:overview|site-config|ai-review|features)/,
  );
});
