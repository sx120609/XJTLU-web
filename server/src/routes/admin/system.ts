import { randomUUID } from "node:crypto";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminJwxtAgentConfigSchema,
  getAdminJwxtAgentSnapshot,
  getAdminSystemHealth,
  issueAdminJwxtAgentToken,
  updateAdminJwxtAgents,
} from "../../services/adminSystemService";
import {
  cleanupDatabaseBackupSnapshot,
  createDatabaseBackupSnapshot,
  DatabaseBackupFailure,
  DatabaseRestoreBusy,
  DatabaseRestoreFailure,
  databaseRestoreUploadLimitBytes,
  getDatabaseBackupStatus,
  isAcceptedDatabaseRestoreFileName,
  restoreDatabaseBackupSnapshot,
} from "../../services/databaseBackup";
import { Errors, ok } from "../../utils/response";

const RESTORE_UPLOAD_PREFIX = "xjtlu-web-db-restore-";
const restoreUploadDirectories = new WeakMap<Request, string>();

class DatabaseRestoreUploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseRestoreUploadRejected";
  }
}

const databaseRestoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      mkdtemp(path.join(tmpdir(), RESTORE_UPLOAD_PREFIX))
        .then((directory) => {
          restoreUploadDirectories.set(_req, directory);
          callback(null, directory);
        })
        .catch((error) => callback(error, ""));
    },
    filename: (_req, _file, callback) => {
      callback(null, randomUUID());
    },
  }),
  fileFilter: (_req, file, callback) => {
    if (!isAcceptedDatabaseRestoreFileName(file.originalname || "")) {
      callback(new DatabaseRestoreUploadRejected(
        "备份文件扩展名不受支持，请选择 .dump、.backup 或 .tar 文件",
      ));
      return;
    }
    callback(null, true);
  },
  limits: {
    files: 1,
    fileSize: databaseRestoreUploadLimitBytes(),
  },
});

async function cleanupDatabaseRestoreUpload(filePath: string) {
  const resolvedFile = path.resolve(filePath);
  const uploadDirectory = path.dirname(resolvedFile);
  const resolvedTempRoot = path.resolve(tmpdir());
  const isOwnedUploadDirectory = (
    path.dirname(uploadDirectory) === resolvedTempRoot
    && path.basename(uploadDirectory).startsWith(RESTORE_UPLOAD_PREFIX)
  );
  if (isOwnedUploadDirectory) {
    await rm(uploadDirectory, { recursive: true, force: true })
      .catch(() => undefined);
    return;
  }
  await unlink(resolvedFile).catch(() => undefined);
}

async function cleanupDatabaseRestoreUploadDirectory(directory: string) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTempRoot = path.resolve(tmpdir());
  const isOwnedUploadDirectory = (
    path.dirname(resolvedDirectory) === resolvedTempRoot
    && path.basename(resolvedDirectory).startsWith(RESTORE_UPLOAD_PREFIX)
  );
  if (!isOwnedUploadDirectory) return;
  await rm(resolvedDirectory, { recursive: true, force: true })
    .catch(() => undefined);
}

function handleDatabaseRestoreUploadError(error: unknown) {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return Errors.badRequest(
      "恢复备份文件过大，请分卷压缩或改用命令行恢复",
    );
  }
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
    return Errors.badRequest("每次只能上传一个数据库备份文件");
  }
  if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") {
    return Errors.badRequest("数据库备份文件字段必须为 file");
  }
  if (error instanceof multer.MulterError) {
    return Errors.badRequest("数据库备份上传格式不正确");
  }
  if (error instanceof DatabaseRestoreUploadRejected) {
    return Errors.badRequest(error.message);
  }
  return error;
}

function handleDatabaseRestoreError(error: unknown) {
  if (error instanceof DatabaseRestoreBusy) {
    return Errors.conflict(error.message);
  }
  if (error instanceof DatabaseRestoreFailure) {
    console.error(`[database-restore:${error.failureCode}]`, error.message);
    if (
      error.failureCode === "restore-failed"
      || error.failureCode === "database-unavailable"
    ) {
      return Errors.server(error.message);
    }
    return Errors.badRequest(error.message);
  }
  return error;
}

export const adminSystemRouter = Router();
adminSystemRouter.use(adminOnly);

adminSystemRouter.get("/jwxt-agents", (req, res, next) => {
  try {
    ok(res, getAdminJwxtAgentSnapshot(req.user!.role));
  } catch (error) {
    next(error);
  }
});

adminSystemRouter.patch(
  "/jwxt-agents",
  validate(adminJwxtAgentConfigSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminJwxtAgents(req.user!.role, req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminSystemRouter.post("/jwxt-agents/generate-token", (req, res, next) => {
  try {
    ok(res, issueAdminJwxtAgentToken(req.user!.role));
  } catch (error) {
    next(error);
  }
});

adminSystemRouter.get("/system/health", async (req, res, next) => {
  try {
    ok(res, await getAdminSystemHealth(req.user!.role));
  } catch (error) {
    next(error);
  }
});

adminSystemRouter.get("/database/status", async (_req, res, next) => {
  try {
    ok(res, await getDatabaseBackupStatus());
  } catch (error) {
    next(error);
  }
});

adminSystemRouter.get("/database/backup", async (_req, res, next) => {
  let snapshot: Awaited<ReturnType<typeof createDatabaseBackupSnapshot>> | null = null;
  try {
    snapshot = await createDatabaseBackupSnapshot();
    res.setHeader("Content-Type", snapshot.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${snapshot.fileName}"; filename*=UTF-8''${encodeURIComponent(snapshot.fileName)}`,
    );
    res.sendFile(snapshot.filePath, async (error) => {
      if (snapshot) await cleanupDatabaseBackupSnapshot(snapshot);
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    if (snapshot) await cleanupDatabaseBackupSnapshot(snapshot);
    if (error instanceof DatabaseBackupFailure) {
      if (error.failureCode === "backup-failed") {
        next(Errors.server(error.message));
      } else {
        next(Errors.badRequest(error.message));
      }
      return;
    }
    next(error);
  }
});

adminSystemRouter.post(
  "/database/restore",
  (req, res, next) => {
    databaseRestoreUpload.single("file")(req, res, (error) => {
      if (error) {
        const uploadDirectory = restoreUploadDirectories.get(req);
        restoreUploadDirectories.delete(req);
        if (uploadDirectory) {
          void cleanupDatabaseRestoreUploadDirectory(uploadDirectory)
            .finally(() => next(handleDatabaseRestoreUploadError(error)));
          return;
        }
        next(handleDatabaseRestoreUploadError(error));
        return;
      }
      next();
    });
  },
  async (req, res, next) => {
    const file = req.file;
    try {
      if (!file?.path || !file.size) {
        throw Errors.badRequest("请先选择要恢复的数据库备份文件");
      }
      ok(res, await restoreDatabaseBackupSnapshot({
        filePath: file.path,
        fileName: file.originalname || "",
        fileSizeBytes: file.size,
      }));
    } catch (error) {
      next(handleDatabaseRestoreError(error));
    } finally {
      if (file?.path) await cleanupDatabaseRestoreUpload(file.path);
      restoreUploadDirectories.delete(req);
    }
  },
);
