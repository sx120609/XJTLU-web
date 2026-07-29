import { Router, type Request } from "express";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminFilestorePatchSchema,
  adminMediaStoragePatchSchema,
  adminStorageCleanupSchema,
  adminStorageDriveSchema,
  adminStorageMigrationSchema,
  beginAdminOneDriveChinaAuthorization,
  cleanupAdminMediaStorage,
  disconnectAdminOneDriveChina,
  getAdminFilestoreStorageConfig,
  getAdminMediaStorageConfig,
  listAdminMediaStorageInventory,
  listAdminOneDriveChinaDrives,
  migrateAdminMediaStorage,
  previewAdminMediaStorageCleanup,
  selectAdminOneDriveChinaDrive,
  updateAdminFilestoreStorageConfig,
  updateAdminMediaStorageConfig,
  validateAdminOneDriveChinaClient,
} from "../../services/adminStorageService";
import { ok } from "../../utils/response";

export const adminStorageRouter = Router();

function actor(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
    ip: req.ip,
  };
}

adminStorageRouter.use(adminOnly);

adminStorageRouter.get("/media-storage", async (req, res, next) => {
  try {
    ok(res, await getAdminMediaStorageConfig(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminStorageRouter.patch(
  "/media-storage",
  validate(adminMediaStoragePatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminMediaStorageConfig(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.get("/filestore-settings", async (req, res, next) => {
  try {
    ok(res, await getAdminFilestoreStorageConfig(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminStorageRouter.patch(
  "/filestore-settings",
  validate(adminFilestorePatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminFilestoreStorageConfig(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.post(
  "/media-storage/onedrive-cn/authorize",
  async (req, res, next) => {
    try {
      ok(res, await beginAdminOneDriveChinaAuthorization(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.post(
  "/media-storage/onedrive-cn/validate-client",
  async (req, res, next) => {
    try {
      ok(res, await validateAdminOneDriveChinaClient(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.get(
  "/media-storage/onedrive-cn/drives",
  async (req, res, next) => {
    try {
      ok(res, await listAdminOneDriveChinaDrives(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.patch(
  "/media-storage/onedrive-cn/drive",
  validate(adminStorageDriveSchema),
  async (req, res, next) => {
    try {
      ok(
        res,
        await selectAdminOneDriveChinaDrive(
          actor(req),
          req.body.driveId,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.delete(
  "/media-storage/onedrive-cn/authorization",
  async (req, res, next) => {
    try {
      ok(res, await disconnectAdminOneDriveChina(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.get("/media-storage/files", async (req, res, next) => {
  try {
    ok(res, await listAdminMediaStorageInventory(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminStorageRouter.post(
  "/media-storage/migrate",
  validate(adminStorageMigrationSchema),
  async (req, res, next) => {
    try {
      ok(res, await migrateAdminMediaStorage(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.post(
  "/media-storage/cleanup-local/preview",
  async (req, res, next) => {
    try {
      ok(res, await previewAdminMediaStorageCleanup(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminStorageRouter.post(
  "/media-storage/cleanup-local",
  validate(adminStorageCleanupSchema),
  async (req, res, next) => {
    try {
      ok(
        res,
        await cleanupAdminMediaStorage(
          actor(req),
          req.body.confirmationToken,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
