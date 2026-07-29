import { Router, type Request } from "express";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminAiReviewLogQuerySchema,
  adminFeaturePatchSchema,
  adminSiteConfigPatchSchema,
  getAdminFeatures,
  getAdminSiteConfig,
  getAdminSitePromptDefaults,
  listAdminAiReviewLogs,
  sweepAdminForumImages,
  sweepAdminForumVideos,
  updateAdminFeatures,
  updateAdminSiteConfig,
} from "../../services/adminSiteService";
import { ok } from "../../utils/response";

export const adminSiteRouter = Router();

function actor(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
  };
}

adminSiteRouter.use(adminOnly);

adminSiteRouter.get("/site-config", (req, res) => {
  ok(res, getAdminSiteConfig(actor(req)));
});

adminSiteRouter.get("/site-config/prompt-defaults", (req, res) => {
  ok(res, getAdminSitePromptDefaults(actor(req)));
});

adminSiteRouter.patch(
  "/site-config",
  validate(adminSiteConfigPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminSiteConfig(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminSiteRouter.post(
  "/ai-review/images/sweep",
  async (req, res, next) => {
    try {
      ok(res, await sweepAdminForumImages(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminSiteRouter.post(
  "/ai-review/videos/sweep",
  async (req, res, next) => {
    try {
      ok(res, await sweepAdminForumVideos(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

adminSiteRouter.get(
  "/ai-review/logs",
  validate(adminAiReviewLogQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminAiReviewLogs(actor(req), req.query));
    } catch (error) {
      next(error);
    }
  },
);

adminSiteRouter.get("/features", (req, res) => {
  ok(res, getAdminFeatures(actor(req)));
});

adminSiteRouter.patch(
  "/features",
  validate(adminFeaturePatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminFeatures(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);
