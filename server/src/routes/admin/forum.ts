import { Router, type Request } from "express";
import { adminOnly, modOrAbove } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminForumMediaPatchSchema,
  adminForumVideoListQuerySchema,
  adminReplyPatchSchema,
  adminReviewTargetParamsSchema,
  adminTopicDeleteQuerySchema,
  adminTopicListQuerySchema,
  adminTopicPatchSchema,
  type AdminForumVideoListQuery,
  type AdminReviewTargetParams,
  type AdminTopicListQuery,
  deleteAdminTopic,
  getAdminReviewTarget,
  listAdminForumVideos,
  listAdminReviewTargetImages,
  listAdminReviewTargetVideos,
  listAdminTopics,
  reviewAdminForumImage,
  reviewAdminForumVideo,
  updateAdminReply,
  updateAdminTopic,
} from "../../services/adminForumService";
import { positiveRouteInteger } from "../../utils/query";
import { Errors, ok } from "../../utils/response";

export const adminForumRouter = Router();

function actor(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
  };
}

function routeId(value: string, label: string) {
  const id = positiveRouteInteger(value);
  if (!id) throw Errors.badRequest(`${label} ID 不合法`);
  return id;
}

adminForumRouter.get(
  "/topics",
  modOrAbove,
  validate(adminTopicListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminTopics(
        actor(req),
        req.query as unknown as AdminTopicListQuery,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.get(
  "/review-targets/:kind/:id",
  modOrAbove,
  validate(adminReviewTargetParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(res, await getAdminReviewTarget(
        actor(req),
        req.params as unknown as AdminReviewTargetParams,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.get(
  "/review-targets/:kind/:id/images",
  modOrAbove,
  validate(adminReviewTargetParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminReviewTargetImages(
        actor(req),
        req.params as unknown as AdminReviewTargetParams,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.get(
  "/review-targets/:kind/:id/videos",
  modOrAbove,
  validate(adminReviewTargetParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminReviewTargetVideos(
        actor(req),
        req.params as unknown as AdminReviewTargetParams,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.patch(
  "/topics/:id",
  modOrAbove,
  validate(adminTopicPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminTopic(
        actor(req),
        routeId(req.params.id, "帖子"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.delete(
  "/topics/:id",
  modOrAbove,
  validate(adminTopicDeleteQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { hard: boolean };
      ok(res, await deleteAdminTopic(
        actor(req),
        routeId(req.params.id, "帖子"),
        query.hard,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.patch(
  "/replies/:id",
  modOrAbove,
  validate(adminReplyPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminReply(
        actor(req),
        routeId(req.params.id, "回复"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.patch(
  "/forum-images/:id",
  modOrAbove,
  validate(adminForumMediaPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await reviewAdminForumImage(
        actor(req),
        routeId(req.params.id, "图片"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.get(
  "/forum-videos",
  adminOnly,
  validate(adminForumVideoListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminForumVideos(
        actor(req),
        req.query as unknown as AdminForumVideoListQuery,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminForumRouter.patch(
  "/forum-videos/:id",
  modOrAbove,
  validate(adminForumMediaPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await reviewAdminForumVideo(
        actor(req),
        routeId(req.params.id, "视频"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);
