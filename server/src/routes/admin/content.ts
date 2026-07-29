import { Router, type Request } from "express";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminAnnouncementCreateSchema,
  adminAnnouncementPatchSchema,
  adminAnnouncementSyncPatchSchema,
  adminWeiwallAuthLinkSchema,
  adminWeiwallAuthStatusParamsSchema,
  adminWeiwallPatchSchema,
  authorizeAdminAnnouncementSync,
  clearAdminAnnouncementSync,
  createAdminAnnouncement,
  createAdminWeiwallAuthSession,
  deleteAdminAnnouncement,
  getAdminAnnouncementSync,
  getAdminWeiwallAuthStatus,
  getAdminWeiwallSync,
  listAdminAnnouncements,
  runAdminAnnouncementSync,
  runAdminWeiwallSync,
  updateAdminAnnouncement,
  updateAdminAnnouncementSync,
  updateAdminWeiwallSync,
} from "../../services/adminContentService";
import { positiveRouteInteger } from "../../utils/query";
import { Errors, ok } from "../../utils/response";

export const adminContentRouter = Router();

function actor(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
  };
}

function announcementId(value: string) {
  const id = positiveRouteInteger(value);
  if (!id) throw Errors.badRequest("公告 ID 不合法");
  return id;
}

adminContentRouter.use(adminOnly);

adminContentRouter.get("/weiwall-sync", async (req, res, next) => {
  try {
    ok(res, await getAdminWeiwallSync(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminContentRouter.patch(
  "/weiwall-sync",
  validate(adminWeiwallPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminWeiwallSync(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.post("/weiwall-sync/run", async (req, res, next) => {
  try {
    ok(res, await runAdminWeiwallSync(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminContentRouter.post(
  "/weiwall-sync/auth-link",
  validate(adminWeiwallAuthLinkSchema),
  async (req, res, next) => {
    try {
      ok(
        res,
        await createAdminWeiwallAuthSession(
          actor(req),
          req.body.origin ?? "",
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.get(
  "/weiwall-sync/auth-status/:flowId",
  validate(adminWeiwallAuthStatusParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(
        res,
        await getAdminWeiwallAuthStatus(actor(req), req.params.flowId),
      );
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.get("/announcement-sync", async (req, res, next) => {
  try {
    ok(res, await getAdminAnnouncementSync(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminContentRouter.post(
  "/announcement-sync/authorize",
  async (req, res, next) => {
    try {
      ok(res, await authorizeAdminAnnouncementSync(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.patch(
  "/announcement-sync",
  validate(adminAnnouncementSyncPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminAnnouncementSync(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.post(
  "/announcement-sync/run",
  async (req, res, next) => {
    try {
      ok(res, await runAdminAnnouncementSync(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.delete(
  "/announcement-sync/authorization",
  async (req, res, next) => {
    try {
      ok(res, await clearAdminAnnouncementSync(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.get("/announcements", async (req, res, next) => {
  try {
    ok(res, await listAdminAnnouncements(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminContentRouter.post(
  "/announcements",
  validate(adminAnnouncementCreateSchema),
  async (req, res, next) => {
    try {
      ok(res, await createAdminAnnouncement(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.patch(
  "/announcements/:id",
  validate(adminAnnouncementPatchSchema),
  async (req, res, next) => {
    try {
      ok(
        res,
        await updateAdminAnnouncement(
          actor(req),
          announcementId(req.params.id),
          req.body,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

adminContentRouter.delete("/announcements/:id", async (req, res, next) => {
  try {
    ok(
      res,
      await deleteAdminAnnouncement(
        actor(req),
        announcementId(req.params.id),
      ),
    );
  } catch (error) {
    next(error);
  }
});
