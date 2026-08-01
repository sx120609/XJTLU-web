import { Router, type Request } from "express";
import { managementPermission, managementRequired } from "../middleware/managementAuth";
import {
  adminBoardCreateSchema,
  adminBoardPatchSchema,
  adminFeedPatchSchema,
  createAdminBoard,
  deleteAdminBoard,
  listAdminBoards,
  listAdminFeedSources,
  resetAndRunAdminFeedSource,
  runAdminFeedSource,
  runAllAdminFeedSources,
  updateAdminBoard,
  updateAdminFeedSource,
} from "../services/adminBoardService";
import {
  adminAnnouncementCreateSchema,
  adminAnnouncementPatchSchema,
  getAdminAnnouncementSync,
  listAdminAnnouncements,
  createAdminAnnouncement,
  updateAdminAnnouncement,
  deleteAdminAnnouncement,
} from "../services/adminContentService";
import {
  adminFeaturePatchSchema,
  adminAiReviewLogQuerySchema,
  adminSiteConfigPatchSchema,
  getAdminFeatures,
  getAdminSiteConfig,
  getAdminSitePromptDefaults,
  listAdminAiReviewLogs,
  updateAdminFeatures,
  updateAdminSiteConfig,
} from "../services/adminSiteService";
import {
  adminJwxtAgentConfigSchema,
  getAdminJwxtAgentSnapshot,
  getAdminSystemHealth,
  issueAdminJwxtAgentToken,
  updateAdminJwxtAgents,
} from "../services/adminSystemService";
import { recordManagementAudit } from "../services/managementAccountService";
import type { ManagementPrincipal } from "../services/managementAuthService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";
import { validate } from "../middleware/validate";

export const managementOperationsRouter = Router();
managementOperationsRouter.use(managementRequired);

function principal(req: Request) {
  if (!req.management) throw Errors.unauthorized("请先登录管理后台");
  return req.management;
}

/**
 * These legacy services only use the role gate and do not write a User FK.
 * Keeping this adapter local makes it impossible to accidentally reuse a
 * management account as a personal user in a future route.
 */
function legacyAdminActor() {
  return { userId: 0, role: "admin" };
}

function routeId(value: string, label: string) {
  const id = positiveRouteInteger(value);
  if (!id) throw Errors.badRequest(`${label} ID 不合法`);
  return id;
}

async function audit(
  actor: ManagementPrincipal,
  action: string,
  targetType: string,
  targetId: string | number,
  summary: string,
  detail: unknown,
  req: Request,
) {
  await recordManagementAudit(
    actor,
    action,
    targetType,
    targetId,
    summary,
    detail,
    req.ip,
  );
}

const content = managementPermission("content.manage");

managementOperationsRouter.get("/boards", content, async (req, res, next) => {
  try { ok(res, await listAdminBoards(legacyAdminActor())); } catch (error) { next(error); }
});

managementOperationsRouter.post(
  "/boards",
  content,
  validate(adminBoardCreateSchema),
  async (req, res, next) => {
    try {
      const result = await createAdminBoard(legacyAdminActor(), req.body);
      await audit(principal(req), "management.board.create", "board", result.id, `创建板块 ${result.name}`, req.body, req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.patch(
  "/boards/:id",
  content,
  validate(adminBoardPatchSchema),
  async (req, res, next) => {
    try {
      const result = await updateAdminBoard(legacyAdminActor(), routeId(req.params.id, "板块"), req.body);
      await audit(principal(req), "management.board.update", "board", result.id, `更新板块 ${result.name}`, req.body, req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.delete("/boards/:id", content, async (req, res, next) => {
  try {
    const id = routeId(req.params.id, "板块");
    const result = await deleteAdminBoard(legacyAdminActor(), id);
    await audit(principal(req), "management.board.delete", "board", id, "删除板块", {}, req);
    ok(res, result);
  } catch (error) { next(error); }
});

managementOperationsRouter.get("/feeds", content, async (req, res, next) => {
  try { ok(res, await listAdminFeedSources(legacyAdminActor())); } catch (error) { next(error); }
});

managementOperationsRouter.patch(
  "/feeds/:id",
  content,
  validate(adminFeedPatchSchema),
  async (req, res, next) => {
    try {
      const id = routeId(req.params.id, "公告源");
      const result = await updateAdminFeedSource(legacyAdminActor(), id, req.body);
      await audit(principal(req), "management.feed.update", "feed_source", id, "更新公告源", req.body, req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.post("/feeds/run-all", content, async (req, res, next) => {
  try {
    const result = await runAllAdminFeedSources(legacyAdminActor());
    await audit(principal(req), "management.feed.run_all", "feed_source", "all", "运行全部公告源同步", {}, req);
    ok(res, result);
  } catch (error) { next(error); }
});

managementOperationsRouter.post("/feeds/:id/run", content, async (req, res, next) => {
  try {
    const id = routeId(req.params.id, "公告源");
    const result = await runAdminFeedSource(legacyAdminActor(), id);
    await audit(principal(req), "management.feed.run", "feed_source", id, "运行公告源同步", {}, req);
    ok(res, result);
  } catch (error) { next(error); }
});

managementOperationsRouter.post("/feeds/:id/reset-run", content, async (req, res, next) => {
  try {
    const id = routeId(req.params.id, "公告源");
    const result = await resetAndRunAdminFeedSource(legacyAdminActor(), id);
    await audit(principal(req), "management.feed.reset_run", "feed_source", id, "重置并运行公告源同步", {}, req);
    ok(res, result);
  } catch (error) { next(error); }
});

managementOperationsRouter.get("/announcements", content, async (req, res, next) => {
  try { ok(res, await listAdminAnnouncements(legacyAdminActor())); } catch (error) { next(error); }
});

managementOperationsRouter.post(
  "/announcements",
  content,
  validate(adminAnnouncementCreateSchema),
  async (req, res, next) => {
    try {
      const result = await createAdminAnnouncement(legacyAdminActor(), req.body);
      await audit(principal(req), "management.announcement.create", "announcement", result.id, `创建公告 ${result.title}`, req.body, req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.patch(
  "/announcements/:id",
  content,
  validate(adminAnnouncementPatchSchema),
  async (req, res, next) => {
    try {
      const id = routeId(req.params.id, "公告");
      const result = await updateAdminAnnouncement(legacyAdminActor(), id, req.body);
      await audit(principal(req), "management.announcement.update", "announcement", id, `更新公告 ${result.title}`, req.body, req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.delete("/announcements/:id", content, async (req, res, next) => {
  try {
    const id = routeId(req.params.id, "公告");
    const result = await deleteAdminAnnouncement(legacyAdminActor(), id);
    await audit(principal(req), "management.announcement.delete", "announcement", id, "删除公告", {}, req);
    ok(res, result);
  } catch (error) { next(error); }
});

const system = managementPermission("system.manage");

managementOperationsRouter.get("/site-config", system, (req, res, next) => {
  try { ok(res, getAdminSiteConfig(legacyAdminActor())); } catch (error) { next(error); }
});

managementOperationsRouter.get("/site-config/prompt-defaults", system, (req, res, next) => {
  try { ok(res, getAdminSitePromptDefaults(legacyAdminActor())); } catch (error) { next(error); }
});

managementOperationsRouter.patch(
  "/site-config",
  system,
  validate(adminSiteConfigPatchSchema),
  async (req, res, next) => {
    try {
      const result = await updateAdminSiteConfig(legacyAdminActor(), req.body);
      await audit(principal(req), "management.site_config.update", "site_config", "singleton", "更新站点配置", Object.keys(req.body), req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.get("/features", system, (req, res, next) => {
  try { ok(res, getAdminFeatures(legacyAdminActor())); } catch (error) { next(error); }
});

managementOperationsRouter.patch(
  "/features",
  system,
  validate(adminFeaturePatchSchema),
  async (req, res, next) => {
    try {
      const result = await updateAdminFeatures(legacyAdminActor(), req.body);
      await audit(principal(req), "management.features.update", "features", "singleton", "更新功能开关", req.body, req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.get(
  "/ai-review/logs",
  system,
  validate(adminAiReviewLogQuerySchema, "query"),
  async (req, res, next) => {
    try { ok(res, await listAdminAiReviewLogs(legacyAdminActor(), req.query)); } catch (error) { next(error); }
  },
);

managementOperationsRouter.get("/announcement-sync", content, async (req, res, next) => {
  try { ok(res, await getAdminAnnouncementSync(legacyAdminActor())); } catch (error) { next(error); }
});

managementOperationsRouter.get("/system/health", system, async (req, res, next) => {
  try { ok(res, await getAdminSystemHealth("admin")); } catch (error) { next(error); }
});

managementOperationsRouter.get("/jwxt-agents", system, (req, res, next) => {
  try { ok(res, getAdminJwxtAgentSnapshot("admin")); } catch (error) { next(error); }
});

managementOperationsRouter.patch(
  "/jwxt-agents",
  system,
  validate(adminJwxtAgentConfigSchema),
  async (req, res, next) => {
    try {
      const result = await updateAdminJwxtAgents("admin", req.body);
      await audit(principal(req), "management.jwxt_agents.update", "jwxt_agents", "singleton", "更新教务 Agent 配置", { agentCount: req.body.agents?.length ?? 0 }, req);
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementOperationsRouter.post("/jwxt-agents/generate-token", system, async (req, res, next) => {
  try {
    const result = issueAdminJwxtAgentToken("admin");
    await audit(principal(req), "management.jwxt_agents.generate_token", "jwxt_agents", "singleton", "生成教务 Agent Token", {}, req);
    ok(res, result);
  } catch (error) { next(error); }
});
