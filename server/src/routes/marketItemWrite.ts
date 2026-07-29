import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketItem,
  marketItemInputSchema,
  marketItemLifecycleSchema,
  marketItemPatchSchema,
  transitionMarketItemLifecycle,
  updateMarketItem,
  withdrawMarketItemCompatibility,
} from "../services/marketItemWriteService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const marketItemWriteRouter = Router();

marketItemWriteRouter.post(
  "/items",
  authRequired,
  validate(marketItemInputSchema),
  async (req, res, next) => {
    try {
      ok(res, await createMarketItem(
        { userId: req.user!.userId, role: req.user!.role },
        req.body as z.infer<typeof marketItemInputSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketItemWriteRouter.patch(
  "/items/:id",
  authRequired,
  validate(marketItemPatchSchema),
  async (req, res, next) => {
    try {
      const id = positiveRouteInteger(req.params.id);
      if (!id) throw Errors.badRequest("商品 ID 不合法");
      ok(res, await updateMarketItem(
        { userId: req.user!.userId, role: req.user!.role },
        id,
        req.body as z.infer<typeof marketItemPatchSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketItemWriteRouter.post(
  "/items/:id/lifecycle",
  authRequired,
  validate(marketItemLifecycleSchema),
  async (req, res, next) => {
    try {
      const id = positiveRouteInteger(req.params.id);
      if (!id) throw Errors.badRequest("商品 ID 不合法");
      ok(res, await transitionMarketItemLifecycle(
        { userId: req.user!.userId, role: req.user!.role },
        id,
        req.body.action,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketItemWriteRouter.delete("/items/:id", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteInteger(req.params.id);
    if (!id) throw Errors.badRequest("商品 ID 不合法");
    ok(res, await withdrawMarketItemCompatibility(
      { userId: req.user!.userId, role: req.user!.role },
      id,
    ));
  } catch (error) {
    next(error);
  }
});
