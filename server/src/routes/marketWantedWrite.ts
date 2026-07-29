import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketWantedPost,
  marketWantedInputSchema,
  marketWantedLifecycleSchema,
  marketWantedPatchSchema,
  transitionMarketWantedPost,
  updateMarketWantedPost,
} from "../services/marketWantedWriteService";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger } from "../utils/query";

export const marketWantedWriteRouter = Router();

marketWantedWriteRouter.post(
  "/wanted",
  authRequired,
  validate(marketWantedInputSchema),
  async (req, res, next) => {
    try {
      ok(res, await createMarketWantedPost(
        { userId: req.user!.userId, role: req.user!.role },
        req.body as z.infer<typeof marketWantedInputSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketWantedWriteRouter.patch(
  "/wanted/:id",
  authRequired,
  validate(marketWantedPatchSchema),
  async (req, res, next) => {
    try {
      const id = positiveRouteInteger(req.params.id);
      if (!id) throw Errors.badRequest("求购 ID 不合法");
      ok(res, await updateMarketWantedPost(
        { userId: req.user!.userId, role: req.user!.role },
        id,
        req.body as z.infer<typeof marketWantedPatchSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketWantedWriteRouter.post(
  "/wanted/:id/lifecycle",
  authRequired,
  validate(marketWantedLifecycleSchema),
  async (req, res, next) => {
    try {
      const id = positiveRouteInteger(req.params.id);
      if (!id) throw Errors.badRequest("求购 ID 不合法");
      ok(res, await transitionMarketWantedPost(
        { userId: req.user!.userId, role: req.user!.role },
        id,
        req.body.action,
      ));
    } catch (error) {
      next(error);
    }
  },
);
