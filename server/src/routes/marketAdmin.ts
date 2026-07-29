import { Router } from "express";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketAdminCategory,
  deleteMarketAdminCategory,
  getMarketAdminConfig,
  getMarketAdminOverview,
  getMarketAdminPayoutProfile,
  handleMarketAdminRefund,
  handleMarketAdminSettlement,
  listMarketAdminCategories,
  marketAdminConfigSchema,
  marketAdminRefundSchema,
  marketAdminSettlementSchema,
  marketAdminWantedSchema,
  marketCategoryCreateSchema,
  marketCategoryPatchSchema,
  marketItemAdminSchema,
  moderateMarketAdminItem,
  moderateMarketAdminWanted,
  updateMarketAdminCategory,
  updateMarketAdminConfig,
} from "../services/marketAdminService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const marketAdminRouter = Router();

function actor(req: any) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
    ip: String(
      req.ip || req.socket?.remoteAddress || "",
    ).trim(),
  };
}

function routeId(value: string, label: string) {
  const id = positiveRouteInteger(value);
  if (!id) throw Errors.badRequest(`${label} ID 不合法`);
  return id;
}

marketAdminRouter.get("/admin/config", authRequired, async (req, res, next) => {
  try {
    ok(res, await getMarketAdminConfig(req.user!.role));
  } catch (error) {
    next(error);
  }
});

marketAdminRouter.patch(
  "/admin/config",
  authRequired,
  validate(marketAdminConfigSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateMarketAdminConfig(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.get(
  "/admin/categories",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await listMarketAdminCategories(req.user!.role));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.post(
  "/admin/categories",
  authRequired,
  validate(marketCategoryCreateSchema),
  async (req, res, next) => {
    try {
      ok(res, await createMarketAdminCategory(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.patch(
  "/admin/categories/:id",
  authRequired,
  validate(marketCategoryPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateMarketAdminCategory(
        actor(req),
        routeId(req.params.id, "品类"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.delete(
  "/admin/categories/:id",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await deleteMarketAdminCategory(
        actor(req),
        routeId(req.params.id, "品类"),
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.get(
  "/admin/overview",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await getMarketAdminOverview(req.user!.role));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.patch(
  "/admin/items/:id",
  authRequired,
  validate(marketItemAdminSchema),
  async (req, res, next) => {
    try {
      ok(res, await moderateMarketAdminItem(
        actor(req),
        routeId(req.params.id, "商品"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.patch(
  "/admin/wanted/:id",
  authRequired,
  validate(marketAdminWantedSchema),
  async (req, res, next) => {
    try {
      ok(res, await moderateMarketAdminWanted(
        actor(req),
        routeId(req.params.id, "求购"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.patch(
  "/admin/refunds/:id",
  authRequired,
  validate(marketAdminRefundSchema),
  async (req, res, next) => {
    try {
      ok(res, await handleMarketAdminRefund(
        actor(req),
        routeId(req.params.id, "退款申请"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.patch(
  "/admin/settlements/:id",
  authRequired,
  validate(marketAdminSettlementSchema),
  async (req, res, next) => {
    try {
      ok(res, await handleMarketAdminSettlement(
        actor(req),
        routeId(req.params.id, "结算单"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketAdminRouter.get(
  "/admin/settlements/:id/payout-profile",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await getMarketAdminPayoutProfile(
        actor(req),
        routeId(req.params.id, "结算单"),
      ));
    } catch (error) {
      next(error);
    }
  },
);
