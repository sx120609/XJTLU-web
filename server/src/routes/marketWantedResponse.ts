import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketWantedResponse,
  marketWantedResponseActionSchema,
  marketWantedResponseInputSchema,
  transitionMarketWantedResponse,
} from "../services/marketWantedResponseService";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger } from "../utils/query";

export const marketWantedResponseRouter = Router();

marketWantedResponseRouter.post(
  "/wanted/:id/responses",
  authRequired,
  validate(marketWantedResponseInputSchema),
  async (req, res, next) => {
    try {
      const wantedPostId = positiveRouteInteger(req.params.id);
      if (!wantedPostId) throw Errors.badRequest("求购 ID 不合法");
      ok(res, await createMarketWantedResponse(
        { userId: req.user!.userId, role: req.user!.role },
        wantedPostId,
        req.body as z.infer<typeof marketWantedResponseInputSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketWantedResponseRouter.patch(
  "/wanted-responses/:id",
  authRequired,
  validate(marketWantedResponseActionSchema),
  async (req, res, next) => {
    try {
      const responseId = positiveRouteInteger(req.params.id);
      if (!responseId) throw Errors.badRequest("求购响应 ID 不合法");
      ok(res, await transitionMarketWantedResponse(
        { userId: req.user!.userId, role: req.user!.role },
        responseId,
        req.body.action,
      ));
    } catch (error) {
      next(error);
    }
  },
);
