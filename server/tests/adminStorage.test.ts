import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adminStorageRouter } from "../src/routes/admin/storage";
import {
  adminFilestorePatchSchema,
  adminMediaStoragePatchSchema,
  adminStorageCleanupSchema,
  adminStorageMigrationSchema,
} from "../src/services/adminStorageService";
import {
  isLocalMediaCleanupCandidate,
  type MediaStorageAdminFileEntry,
} from "../src/services/mediaStorage";
import {
  normalizeSharePointUrl,
  serializeMediaStorageAdminConfig,
  type MediaStorageStoredConfig,
} from "../src/services/storageConfig";

const storedConfig: MediaStorageStoredConfig = {
  mediaStorageProvider: "local",
  mediaStorageImageProvider: "local",
  mediaStorageVideoProvider: "local",
  mediaStorageRemotePrefixes: ["forum"],
  filestoreRemoteStorageEnabled: false,
  filestoreRemoteMinSizeMb: 0,
  oneDriveChinaClientId: "client-id",
  oneDriveChinaClientSecret: "very-secret",
  oneDriveChinaSharepointUrl: "https://tenant.sharepoint.cn/sites/media",
  oneDriveChinaSharepointHost: "tenant.sharepoint.cn",
  oneDriveChinaSharepointPath: "/sites/media",
  oneDriveChinaSiteId: "site-id",
  oneDriveChinaSiteName: "Media",
  oneDriveChinaDriveId: "drive-id",
  oneDriveChinaDriveName: "Documents",
  oneDriveChinaRootPath: "xjtlu-web",
  oneDriveChinaRefreshToken: "refresh-secret",
  oneDriveChinaAuthorizedAt: "2026-07-28T00:00:00.000Z",
  oneDriveChinaLastError: "",
};

function mediaRow(
  patch: Partial<MediaStorageAdminFileEntry> = {},
): MediaStorageAdminFileEntry {
  return {
    relativePath: "forum/2026-07/image.png",
    url: "/uploads/forum/2026-07/image.png",
    mediaKind: "image",
    configuredBackend: "onedrive-cn",
    inRemotePrefix: true,
    localExists: true,
    cacheExists: true,
    remoteExists: true,
    localSizeBytes: 10,
    cacheSizeBytes: 10,
    remoteSizeBytes: 10,
    localUpdatedAt: "",
    cacheUpdatedAt: "",
    remoteUpdatedAt: "",
    ...patch,
  };
}

test("storage schemas reject empty, unknown, conflicting, or unsafe writes", () => {
  assert.equal(adminMediaStoragePatchSchema.safeParse({}).success, false);
  assert.equal(adminFilestorePatchSchema.safeParse({}).success, false);
  assert.equal(
    adminFilestorePatchSchema.safeParse({
      enabled: true,
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    adminMediaStoragePatchSchema.safeParse({
      oneDriveChinaClientSecret: "new-secret",
      clearOneDriveChinaClientSecret: true,
    }).success,
    false,
  );
  assert.equal(
    adminMediaStoragePatchSchema.safeParse({
      mediaStorageRemotePrefixes: "../private",
    }).success,
    false,
  );
  assert.equal(
    adminStorageMigrationSchema.safeParse({
      excludePaths: ["../../etc/passwd"],
    }).success,
    false,
  );
  assert.equal(adminStorageCleanupSchema.safeParse({}).success, false);
});

test("SharePoint addresses require credential-free HTTPS", () => {
  assert.throws(
    () => normalizeSharePointUrl("http://tenant.sharepoint.cn/sites/media"),
    /HTTPS/,
  );
  assert.throws(
    () => normalizeSharePointUrl(
      "https://user:pass@tenant.sharepoint.cn/sites/media",
    ),
    /HTTPS/,
  );
  assert.equal(
    normalizeSharePointUrl(
      "tenant.sharepoint.cn/sites/media?view=1#section",
    ),
    "https://tenant.sharepoint.cn/sites/media",
  );
});

test("admin storage serialization never exposes stored secrets", () => {
  const output = serializeMediaStorageAdminConfig(storedConfig);
  assert.equal(
    Object.hasOwn(output, "oneDriveChinaClientSecret"),
    false,
  );
  assert.equal(
    Object.hasOwn(output, "oneDriveChinaRefreshToken"),
    false,
  );
  assert.equal(output.oneDriveChinaClientSecretConfigured, true);
  assert.equal(output.oneDriveChinaRefreshTokenConfigured, true);
});

test("local cleanup only accepts remote-backed in-scope redundant copies", () => {
  assert.equal(isLocalMediaCleanupCandidate(mediaRow()), true);
  assert.equal(
    isLocalMediaCleanupCandidate(mediaRow({ remoteExists: false })),
    false,
  );
  assert.equal(
    isLocalMediaCleanupCandidate(mediaRow({ inRemotePrefix: false })),
    false,
  );
  assert.equal(
    isLocalMediaCleanupCandidate(
      mediaRow({ configuredBackend: "local" }),
    ),
    false,
  );
});

test("storage routes are isolated and destructive cleanup is token gated", () => {
  const adminIndex = readFileSync(
    new URL("../src/routes/admin/index.ts", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../src/routes/admin/storage.ts", import.meta.url),
    "utf8",
  );
  const storageCallback = readFileSync(
    new URL("../src/routes/storage.ts", import.meta.url),
    "utf8",
  );
  const oneDriveService = readFileSync(
    new URL("../src/services/oneDriveChina.ts", import.meta.url),
    "utf8",
  );
  const mediaService = readFileSync(
    new URL("../src/services/mediaStorage.ts", import.meta.url),
    "utf8",
  );
  const cleanupSection = mediaService.slice(
    mediaService.indexOf(
      "export async function cleanupMigratedLocalMediaAssets",
    ),
    mediaService.indexOf("export const uploadAssetHandler"),
  );

  assert.ok(adminStorageRouter);
  assert.match(adminIndex, /adminStorageRouter/);
  assert.equal(adminIndex.split(/\r?\n/).length < 40, true);
  assert.match(route, /cleanup-local\/preview/);
  assert.match(route, /adminStorageCleanupSchema/);
  assert.match(storageCallback, /recordAdminOneDriveChinaAuthorizationError/);
  assert.doesNotMatch(storageCallback, /x-forwarded-host|headers\.host/i);
  assert.match(oneDriveService, /validateOneDriveChinaAuthorizationState/);
  assert.match(oneDriveService, /admin\.role !== "admin"/);
  assert.doesNotMatch(oneDriveService, /configuredOrigin \|\| requestOrigin/);
  assert.doesNotMatch(cleanupSection, /deleteOneDriveChinaFile/);
});
