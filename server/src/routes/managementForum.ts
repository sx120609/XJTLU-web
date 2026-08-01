import { Router, type Request } from "express";
import { managementPermission, managementRequired } from "../middleware/managementAuth";
import { validate } from "../middleware/validate";
import {
  adminForumMediaPatchSchema,
  adminForumVideoListQuerySchema,
  adminReplyPatchSchema,
  adminReviewTargetParamsSchema,
  adminTopicDeleteQuerySchema,
  adminTopicListQuerySchema,
  adminTopicPatchSchema,
  type AdminForumActor,
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
} from "../services/adminForumService";
import { recordManagementAudit } from "../services/managementAccountService";
import { requireManagementPermission } from "../services/managementAuthService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const managementForumRouter = Router();

function principal(req: Request) {
  if (!req.management) throw Errors.unauthorized("请先登录管理后台");
  return req.management;
}

function actor(req: Request): AdminForumActor {
  const current = principal(req);
  return {
    adminAccountId: current.adminAccountId,
    accountType: current.accountType,
  };
}

function routeId(value: string, label: string) {
  const parsed = positiveRouteInteger(value);
  if (!parsed) throw Errors.badRequest(`${label} ID 不合法`);
  return parsed;
}

managementForumRouter.use(managementRequired);

managementForumRouter.get(
  "/forum/topics",
  managementPermission("forum.review"),
  validate(adminTopicListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminTopics(actor(req), req.query as unknown as AdminTopicListQuery));
    } catch (error) { next(error); }
  },
);

managementForumRouter.get(
  "/forum/review-targets/:kind/:id",
  managementPermission("forum.review"),
  validate(adminReviewTargetParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(res, await getAdminReviewTarget(actor(req), req.params as unknown as AdminReviewTargetParams));
    } catch (error) { next(error); }
  },
);

managementForumRouter.get(
  "/forum/review-targets/:kind/:id/images",
  managementPermission("forum.review"),
  validate(adminReviewTargetParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminReviewTargetImages(actor(req), req.params as unknown as AdminReviewTargetParams));
    } catch (error) { next(error); }
  },
);

managementForumRouter.get(
  "/forum/review-targets/:kind/:id/videos",
  managementPermission("forum.review"),
  validate(adminReviewTargetParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminReviewTargetVideos(actor(req), req.params as unknown as AdminReviewTargetParams));
    } catch (error) { next(error); }
  },
);

managementForumRouter.patch(
  "/forum/topics/:id",
  validate(adminTopicPatchSchema),
  async (req, res, next) => {
    try {
      const current = principal(req);
      const topicId = routeId(req.params.id, "帖子");
      const patch = req.body;
      const moderationFields = ["hidden", "pinned", "globalPinned", "locked", "boardSlug"];
      if (moderationFields.some((field) => patch[field] !== undefined)) {
        await requireManagementPermission(current, "forum.moderate");
      }
      if (patch.aiReviewStatus !== undefined || patch.manualReviewNote !== undefined) {
        await requireManagementPermission(current, "forum.review");
      }
      const result = await updateAdminTopic(actor(req), topicId, patch);
      await recordManagementAudit(current, "management.forum.topic_update", "topic", topicId, "更新帖子审核或治理状态", patch, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementForumRouter.delete(
  "/forum/topics/:id",
  managementPermission("forum.moderate"),
  validate(adminTopicDeleteQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const current = principal(req);
      const topicId = routeId(req.params.id, "帖子");
      const query = req.query as unknown as { hard: boolean };
      const result = await deleteAdminTopic(actor(req), topicId, query.hard);
      await recordManagementAudit(current, "management.forum.topic_delete", "topic", topicId, query.hard ? "永久删除帖子" : "隐藏帖子", result, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementForumRouter.patch(
  "/forum/replies/:id",
  managementPermission("forum.review"),
  validate(adminReplyPatchSchema),
  async (req, res, next) => {
    try {
      const current = principal(req);
      const replyId = routeId(req.params.id, "回复");
      const result = await updateAdminReply(actor(req), replyId, req.body);
      await recordManagementAudit(current, "management.forum.reply_review", "reply", replyId, "处理回复人工审核", req.body, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementForumRouter.patch(
  "/forum/images/:id",
  managementPermission("forum.review"),
  validate(adminForumMediaPatchSchema),
  async (req, res, next) => {
    try {
      const current = principal(req);
      const assetId = routeId(req.params.id, "图片");
      const result = await reviewAdminForumImage(actor(req), assetId, req.body);
      await recordManagementAudit(current, "management.forum.image_review", "forum_image", assetId, "处理帖子图片人工审核", req.body, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementForumRouter.get(
  "/forum/videos",
  managementPermission("forum.review"),
  validate(adminForumVideoListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminForumVideos(actor(req), req.query as unknown as AdminForumVideoListQuery));
    } catch (error) { next(error); }
  },
);

managementForumRouter.patch(
  "/forum/videos/:id",
  managementPermission("forum.review"),
  validate(adminForumMediaPatchSchema),
  async (req, res, next) => {
    try {
      const current = principal(req);
      const assetId = routeId(req.params.id, "视频");
      const result = await reviewAdminForumVideo(actor(req), assetId, req.body);
      await recordManagementAudit(current, "management.forum.video_review", "forum_video", assetId, "处理帖子视频人工审核", req.body, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);
