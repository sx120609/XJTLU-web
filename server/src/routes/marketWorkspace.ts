import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  getMarketPreference,
  getMarketSellerDashboard,
  getMarketWorkspace,
  getPublicMarketUserProfile,
  marketPayoutProfileSchema,
  marketPreferenceSchema,
  saveMarketPayoutProfile,
  toggleMarketFavorite,
  updateMarketPreference,
} from "../services/marketWorkspaceService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const marketWorkspaceRouter = Router();

function actor(req: any) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
  };
}

marketWorkspaceRouter.get(
  "/preferences",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await getMarketPreference(req.user!.userId));
    } catch (error) {
      next(error);
    }
  },
);

marketWorkspaceRouter.patch(
  "/preferences",
  authRequired,
  validate(marketPreferenceSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateMarketPreference(
        req.user!.userId,
        req.body as z.infer<typeof marketPreferenceSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketWorkspaceRouter.post(
  "/items/:id/favorite",
  authRequired,
  async (req, res, next) => {
    try {
      const itemId = positiveRouteInteger(req.params.id);
      if (!itemId) throw Errors.badRequest("商品 ID 不合法");
      ok(res, await toggleMarketFavorite(actor(req), itemId));
    } catch (error) {
      next(error);
    }
  },
);

marketWorkspaceRouter.get(
  "/mine",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await getMarketWorkspace(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

marketWorkspaceRouter.get(
  "/seller/dashboard",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await getMarketSellerDashboard(actor(req)));
    } catch (error) {
      next(error);
    }
  },
);

marketWorkspaceRouter.get("/users/:id/profile", async (req, res, next) => {
  try {
    const userId = positiveRouteInteger(req.params.id);
    if (!userId) throw Errors.badRequest("用户 ID 不合法");
    ok(res, await getPublicMarketUserProfile(userId, req.user?.userId));
  } catch (error) {
    next(error);
  }
});

marketWorkspaceRouter.patch(
  "/payout-profile",
  authRequired,
  validate(marketPayoutProfileSchema),
  async (req, res, next) => {
    try {
      ok(res, await saveMarketPayoutProfile(
        req.user!.userId,
        req.body as z.infer<typeof marketPayoutProfileSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);
