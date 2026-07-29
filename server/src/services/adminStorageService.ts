import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config";
import { prisma } from "../prisma";
import { Errors, HttpError } from "../utils/response";
import { runWithDistributedLock } from "./cache";
import {
  cleanupMigratedLocalMediaAssets,
  isLocalMediaCleanupCandidate,
  listMediaStorageAdminInventory,
  migrateLocalMediaAssetsToRemote,
  type MediaStorageAdminInventory,
} from "./mediaStorage";
import {
  buildOneDriveChinaAuthorization,
  completeOneDriveChinaAuthorization,
  disconnectOneDriveChinaAuthorization,
  getOneDriveChinaCallbackUrl,
  listOneDriveChinaDriveOptions,
  saveOneDriveChinaDriveSelection,
  validateOneDriveChinaAuthorizationState,
  validateOneDriveChinaClientCredentials,
} from "./oneDriveChina";
import {
  getFilestoreStorageAdminConfig,
  getMediaStorageAdminConfig,
  setOneDriveChinaLastError,
  updateFilestoreStorageAdminConfig,
  updateMediaStorageAdminConfig,
  type MediaStorageAdminPatch,
} from "./storageConfig";

export type AdminStorageActor = {
  userId: number;
  role: string;
  ip?: string;
};

const remotePrefix = z.string().trim().min(1).max(80).refine(
  (value) => {
    const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return Boolean(normalized)
      && normalized.split("/").every(
        (segment) => segment !== "." && segment !== "..",
      );
  },
  "远端前缀不能包含空目录、. 或 ..",
);

const nonEmptyStrictObject = <T extends z.ZodRawShape>(shape: T) => z
  .object(shape)
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少提交一个字段");

export const adminFilestorePatchSchema = nonEmptyStrictObject({
  enabled: z.boolean().optional(),
  minSizeMb: z.number().finite().min(0).max(10240).optional(),
});

export const adminMediaStoragePatchSchema = nonEmptyStrictObject({
  mediaStorageProvider: z.enum(["local", "onedrive-cn"]).optional(),
  mediaStorageImageProvider: z.enum(["local", "onedrive-cn"]).optional(),
  mediaStorageVideoProvider: z.enum(["local", "onedrive-cn"]).optional(),
  mediaStorageRemotePrefixes: z.union([
    z.string().trim().min(1).max(200).refine(
      (value) => value.split(",").every(
        (item) => remotePrefix.safeParse(item).success,
      ),
      "远端前缀格式不正确",
    ),
    z.array(remotePrefix).min(1).max(10),
  ]).optional(),
  oneDriveChinaClientId: z.string().trim().max(120).optional(),
  oneDriveChinaClientSecret: z.string().trim().min(1).max(240).optional(),
  clearOneDriveChinaClientSecret: z.boolean().optional(),
  oneDriveChinaSharepointUrl: z.string().trim().max(500).optional(),
  oneDriveChinaRootPath: z.string().trim().max(240).optional(),
}).superRefine((value, context) => {
  if (
    value.clearOneDriveChinaClientSecret
    && value.oneDriveChinaClientSecret !== undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "不能同时设置并清除 Azure 应用密钥",
      path: ["clearOneDriveChinaClientSecret"],
    });
  }
});

export const adminStorageDriveSchema = z.object({
  driveId: z.string().trim().min(1).max(160),
}).strict();

const inventoryRelativePath = z.string().trim().min(1).max(800).refine(
  (value) => {
    const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
    return !/^[a-z]:/i.test(value)
      && !value.startsWith("/")
      && normalized.split("/").every(
        (segment) => segment !== "." && segment !== "..",
      );
  },
  "排除路径格式不正确",
);

export const adminStorageMigrationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  excludePaths: z.array(inventoryRelativePath).max(2000).optional(),
}).strict();

export const adminStorageCleanupSchema = z.object({
  confirmationToken: z.string().trim().min(1).max(2000),
}).strict();

type CleanupTokenPayload = {
  kind: "media-storage-local-cleanup";
  adminUserId: number;
  snapshot: string;
  eligible: number;
};

function requireAdmin(actor: AdminStorageActor) {
  if (actor.role !== "admin") {
    throw Errors.forbidden("仅管理员可操作存储配置");
  }
}

function asAdminError(error: unknown, fallback: string): never {
  if (error instanceof HttpError) throw error;
  throw Errors.badRequest(
    error instanceof Error && error.message ? error.message : fallback,
  );
}

async function withStorageExclusive<T>(
  task: () => Promise<T>,
  ttlMs = 15 * 60_000,
) {
  const locked = await runWithDistributedLock(
    "admin-storage:exclusive",
    ttlMs,
    task,
  );
  if (!locked.acquired) {
    throw Errors.conflict("另一项存储配置、迁移或清理操作正在执行");
  }
  return locked.result;
}

async function recordAction(
  actor: AdminStorageActor,
  action: string,
  summary: string,
  detail: Record<string, unknown>,
) {
  await prisma.adminActionLog.create({
    data: {
      actorId: actor.userId,
      action,
      targetType: "media-storage",
      targetId: "global",
      summary,
      detail: JSON.stringify(detail),
      ip: String(actor.ip || "").slice(0, 120),
    },
  }).catch(() => null);
}

export async function getAdminMediaStorageConfig(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  const [storage, filestore] = await Promise.all([
    getMediaStorageAdminConfig(),
    getFilestoreStorageAdminConfig(),
  ]);
  let callbackUrl = "";
  let callbackError = "";
  try {
    callbackUrl = getOneDriveChinaCallbackUrl();
  } catch (error) {
    callbackError = error instanceof Error ? error.message : "回调地址不可用";
  }
  return {
    ...storage,
    remoteReady: filestore.remoteReady,
    oneDriveChinaCallbackUrl: callbackUrl,
    oneDriveChinaCallbackError: callbackError,
  };
}

export async function getAdminFilestoreStorageConfig(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  return getFilestoreStorageAdminConfig();
}

export async function updateAdminMediaStorageConfig(
  actor: AdminStorageActor,
  patch: MediaStorageAdminPatch,
) {
  requireAdmin(actor);
  try {
    const result = await withStorageExclusive(
      () => updateMediaStorageAdminConfig(patch),
      30_000,
    );
    await recordAction(
      actor,
      "media-storage.config.update",
      "更新媒体存储配置",
      {
        fields: Object.keys(patch).filter(
          (key) => key !== "oneDriveChinaClientSecret",
        ),
        clientSecretChanged: patch.oneDriveChinaClientSecret !== undefined
          || Boolean(patch.clearOneDriveChinaClientSecret),
      },
    );
    return {
      ...result,
      ...(await getAdminMediaStorageConfig(actor)),
    };
  } catch (error) {
    asAdminError(error, "媒体存储配置不正确");
  }
}

export async function updateAdminFilestoreStorageConfig(
  actor: AdminStorageActor,
  patch: { enabled?: boolean; minSizeMb?: number },
) {
  requireAdmin(actor);
  try {
    const result = await withStorageExclusive(
      () => updateFilestoreStorageAdminConfig(patch),
      30_000,
    );
    await recordAction(
      actor,
      "media-storage.filestore.update",
      "更新文件收集远端存储配置",
      patch,
    );
    return result;
  } catch (error) {
    asAdminError(error, "文件收集远端存储配置不正确");
  }
}

export async function beginAdminOneDriveChinaAuthorization(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  try {
    return await buildOneDriveChinaAuthorization({
      adminUserId: actor.userId,
    });
  } catch (error) {
    asAdminError(error, "无法发起世纪互联授权");
  }
}

export async function validateAdminOneDriveChinaClient(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  try {
    return await validateOneDriveChinaClientCredentials();
  } catch (error) {
    asAdminError(error, "Azure 应用密钥校验失败");
  }
}

export async function listAdminOneDriveChinaDrives(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  try {
    return await withStorageExclusive(
      listOneDriveChinaDriveOptions,
      2 * 60_000,
    );
  } catch (error) {
    asAdminError(error, "读取 SharePoint 文档库失败");
  }
}

export async function selectAdminOneDriveChinaDrive(
  actor: AdminStorageActor,
  driveId: string,
) {
  requireAdmin(actor);
  try {
    const result = await withStorageExclusive(
      () => saveOneDriveChinaDriveSelection(driveId),
      2 * 60_000,
    );
    await recordAction(
      actor,
      "media-storage.drive.select",
      "选择 SharePoint 文档库",
      { driveId: result.driveId, driveName: result.driveName },
    );
    return result;
  } catch (error) {
    asAdminError(error, "保存 SharePoint 文档库失败");
  }
}

export async function disconnectAdminOneDriveChina(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  try {
    await withStorageExclusive(
      disconnectOneDriveChinaAuthorization,
      30_000,
    );
    await recordAction(
      actor,
      "media-storage.authorization.clear",
      "清除世纪互联存储授权",
      {},
    );
    return { ok: true as const };
  } catch (error) {
    asAdminError(error, "清除世纪互联授权失败");
  }
}

export async function listAdminMediaStorageInventory(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  return listMediaStorageAdminInventory();
}

export async function migrateAdminMediaStorage(
  actor: AdminStorageActor,
  input: { limit?: number; excludePaths?: string[] },
) {
  requireAdmin(actor);
  const result = await withStorageExclusive(
    () => migrateLocalMediaAssetsToRemote(input),
  );
  await recordAction(
    actor,
    "media-storage.migrate",
    "按当前后端同步媒体文件",
    {
      eligible: result.eligible,
      processed: result.processed,
      migrated: result.migrated,
      failed: result.failed,
    },
  );
  return result;
}

function localCleanupSnapshot(inventory: MediaStorageAdminInventory) {
  const rows = inventory.list
    .filter(isLocalMediaCleanupCandidate)
    .map((row) => ({
      relativePath: row.relativePath,
      localSizeBytes: row.localSizeBytes,
      cacheSizeBytes: row.cacheSizeBytes,
      remoteSizeBytes: row.remoteSizeBytes,
      localUpdatedAt: row.localUpdatedAt,
      cacheUpdatedAt: row.cacheUpdatedAt,
      remoteUpdatedAt: row.remoteUpdatedAt,
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const snapshot = createHash("sha256").update(JSON.stringify({
    imageProvider: inventory.mediaStorageImageProvider,
    videoProvider: inventory.mediaStorageVideoProvider,
    remotePrefixes: inventory.remotePrefixes,
    rows,
  })).digest("hex");
  return { rows, snapshot };
}

export async function previewAdminMediaStorageCleanup(
  actor: AdminStorageActor,
) {
  requireAdmin(actor);
  const inventory = await listMediaStorageAdminInventory();
  const current = localCleanupSnapshot(inventory);
  if (!current.rows.length) {
    return {
      eligible: 0,
      confirmationToken: "",
      expiresAt: "",
    };
  }
  const expiresInSeconds = 5 * 60;
  const confirmationToken = jwt.sign({
    kind: "media-storage-local-cleanup",
    adminUserId: actor.userId,
    snapshot: current.snapshot,
    eligible: current.rows.length,
  } satisfies CleanupTokenPayload, config.jwtSecret, {
    expiresIn: expiresInSeconds,
  });
  return {
    eligible: current.rows.length,
    confirmationToken,
    expiresAt: new Date(
      Date.now() + expiresInSeconds * 1000,
    ).toISOString(),
  };
}

function verifyCleanupToken(
  actor: AdminStorageActor,
  token: string,
) {
  let payload: CleanupTokenPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as CleanupTokenPayload;
  } catch {
    throw Errors.badRequest("清理确认已失效，请重新预览后确认");
  }
  if (
    payload.kind !== "media-storage-local-cleanup"
    || payload.adminUserId !== actor.userId
    || !payload.snapshot
    || !Number.isInteger(payload.eligible)
  ) {
    throw Errors.badRequest("清理确认无效，请重新预览后确认");
  }
  return payload;
}

export async function cleanupAdminMediaStorage(
  actor: AdminStorageActor,
  confirmationToken: string,
) {
  requireAdmin(actor);
  const token = verifyCleanupToken(actor, confirmationToken);
  const result = await withStorageExclusive(async () => {
    const inventory = await listMediaStorageAdminInventory();
    const current = localCleanupSnapshot(inventory);
    if (
      current.snapshot !== token.snapshot
      || current.rows.length !== token.eligible
    ) {
      throw Errors.conflict("媒体文件状态已变化，请重新预览后确认清理");
    }
    return cleanupMigratedLocalMediaAssets({ inventory });
  });
  await recordAction(
    actor,
    "media-storage.cleanup-local",
    "清理远端已落盘媒体的本地副本",
    {
      eligible: result.eligible,
      removed: result.removed,
      failed: result.failed,
    },
  );
  return result;
}

export async function completeAdminOneDriveChinaAuthorization(
  input: { code: string; state: string },
) {
  return withStorageExclusive(
    () => completeOneDriveChinaAuthorization(input),
    2 * 60_000,
  );
}

export async function recordAdminOneDriveChinaAuthorizationError(
  state: string,
  message: string,
) {
  await validateOneDriveChinaAuthorizationState(state);
  await withStorageExclusive(
    () => setOneDriveChinaLastError(message.slice(0, 500)),
    30_000,
  );
}
