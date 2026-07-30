import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketAppeal,
  createMarketReport,
  createMarketReview,
  createMarketSafetyRule,
  createMarketViolation,
  deleteMarketSafetyRule,
  adjustMarketPositiveRate,
  getPrivateMarketTrustProfile,
  getPublicMarketTrustProfile,
  handleMarketAppeal,
  handleMarketReport,
  listMarketAdminActionLogs,
  listMarketReviews,
  marketAdminReportActionSchema,
  marketPositiveRateAdjustmentSchema,
  marketAppealActionSchema,
  marketAppealCreateSchema,
  marketReportSchema,
  marketReviewSchema,
  marketSafetyRulePatchSchema,
  marketSafetyRuleSchema,
  marketViolationCreateSchema,
  marketViolationRevokeSchema,
  revokeMarketViolation,
  updateMarketSafetyRule,
} from "../services/marketGovernanceService";
import { positiveRouteInteger, queryPage, querySize } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const marketGovernanceRouter = Router();

function requestIp(req: any) {
  return String(
    req.headers?.["x-forwarded-for"]
    || req.ip
    || req.socket?.remoteAddress
    || "",
  ).split(",")[0].trim();
}

function actor(req: any) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
    ip: requestIp(req),
  };
}

marketGovernanceRouter.post(
  "/orders/:id/reviews",
  authRequired,
  validate(marketReviewSchema),
  async (req, res, next) => {
    try {
      const orderId = positiveRouteInteger(req.params.id);
      if (!orderId) throw Errors.badRequest("订单 ID 不合法");
      ok(res, await createMarketReview(
        actor(req),
        orderId,
        req.body as z.infer<typeof marketReviewSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.get("/users/:id/reviews", async (req, res, next) => {
  try {
    const userId = positiveRouteInteger(req.params.id);
    if (!userId) throw Errors.badRequest("用户 ID 不合法");
    ok(res, await listMarketReviews(userId));
  } catch (error) {
    next(error);
  }
});

marketGovernanceRouter.get("/users/:id/trust", async (req, res, next) => {
  try {
    const userId = positiveRouteInteger(req.params.id);
    if (!userId) throw Errors.badRequest("用户 ID 不合法");
    ok(res, await getPublicMarketTrustProfile(userId));
  } catch (error) {
    next(error);
  }
});

marketGovernanceRouter.get("/trust/me", authRequired, async (req, res, next) => {
  try {
    ok(res, await getPrivateMarketTrustProfile(req.user!.userId));
  } catch (error) {
    next(error);
  }
});

marketGovernanceRouter.patch(
  "/admin/users/:id/positive-rate",
  authRequired,
  validate(marketPositiveRateAdjustmentSchema),
  async (req, res, next) => {
    try {
      const userId = positiveRouteInteger(req.params.id);
      if (!userId) throw Errors.badRequest("用户 ID 不合法");
      ok(res, await adjustMarketPositiveRate(
        actor(req),
        userId,
        req.body as z.infer<typeof marketPositiveRateAdjustmentSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.post(
  "/violations/:id/appeals",
  authRequired,
  validate(marketAppealCreateSchema),
  async (req, res, next) => {
    try {
      const violationId = positiveRouteInteger(req.params.id);
      if (!violationId) throw Errors.badRequest("违规记录 ID 不合法");
      ok(res, await createMarketAppeal(
        actor(req),
        violationId,
        req.body as z.infer<typeof marketAppealCreateSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

function reportHandler(
  kind: "item" | "wanted" | "user" | "order",
  idLabel: string,
) {
  return async (req: any, res: any, next: any) => {
    try {
      const id = positiveRouteInteger(req.params.id);
      if (!id) throw Errors.badRequest(`${idLabel} ID 不合法`);
      ok(res, await createMarketReport(
        actor(req),
        { kind, id },
        req.body as z.infer<typeof marketReportSchema>,
      ));
    } catch (error) {
      next(error);
    }
  };
}

marketGovernanceRouter.post(
  "/items/:id/reports",
  authRequired,
  validate(marketReportSchema),
  reportHandler("item", "商品"),
);

marketGovernanceRouter.post(
  "/wanted/:id/reports",
  authRequired,
  validate(marketReportSchema),
  reportHandler("wanted", "求购"),
);

marketGovernanceRouter.post(
  "/users/:id/reports",
  authRequired,
  validate(marketReportSchema),
  reportHandler("user", "用户"),
);

marketGovernanceRouter.post(
  "/orders/:id/report",
  authRequired,
  validate(marketReportSchema),
  reportHandler("order", "订单"),
);

marketGovernanceRouter.post(
  "/admin/safety-rules",
  authRequired,
  validate(marketSafetyRuleSchema),
  async (req, res, next) => {
    try {
      ok(res, await createMarketSafetyRule(
        actor(req),
        req.body as z.infer<typeof marketSafetyRuleSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.patch(
  "/admin/safety-rules/:id",
  authRequired,
  validate(marketSafetyRulePatchSchema),
  async (req, res, next) => {
    try {
      const ruleId = positiveRouteInteger(req.params.id);
      if (!ruleId) throw Errors.badRequest("安全规则 ID 不合法");
      ok(res, await updateMarketSafetyRule(
        actor(req),
        ruleId,
        req.body as z.infer<typeof marketSafetyRulePatchSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.delete(
  "/admin/safety-rules/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const ruleId = positiveRouteInteger(req.params.id);
      if (!ruleId) throw Errors.badRequest("安全规则 ID 不合法");
      ok(res, await deleteMarketSafetyRule(actor(req), ruleId));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.post(
  "/admin/violations",
  authRequired,
  validate(marketViolationCreateSchema),
  async (req, res, next) => {
    try {
      ok(res, await createMarketViolation(
        actor(req),
        req.body as z.infer<typeof marketViolationCreateSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.patch(
  "/admin/violations/:id",
  authRequired,
  validate(marketViolationRevokeSchema),
  async (req, res, next) => {
    try {
      const violationId = positiveRouteInteger(req.params.id);
      if (!violationId) throw Errors.badRequest("违规记录 ID 不合法");
      ok(res, await revokeMarketViolation(
        actor(req),
        violationId,
        req.body as z.infer<typeof marketViolationRevokeSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.patch(
  "/admin/appeals/:id",
  authRequired,
  validate(marketAppealActionSchema),
  async (req, res, next) => {
    try {
      const appealId = positiveRouteInteger(req.params.id);
      if (!appealId) throw Errors.badRequest("申诉 ID 不合法");
      ok(res, await handleMarketAppeal(
        actor(req),
        appealId,
        req.body as z.infer<typeof marketAppealActionSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.get(
  "/admin/action-logs",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await listMarketAdminActionLogs(
        actor(req),
        queryPage(req.query.page),
        querySize(req.query.size, 30, 1, 100),
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketGovernanceRouter.patch(
  "/admin/reports/:id",
  authRequired,
  validate(marketAdminReportActionSchema),
  async (req, res, next) => {
    try {
      const reportId = positiveRouteInteger(req.params.id);
      if (!reportId) throw Errors.badRequest("举报 ID 不合法");
      ok(res, await handleMarketReport(
        actor(req),
        reportId,
        req.body as z.infer<typeof marketAdminReportActionSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);
