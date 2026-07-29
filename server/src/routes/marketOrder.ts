import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  marketOrderActionSchema,
  transitionMarketOrder,
} from "../services/marketOrderFulfillmentService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const marketOrderRouter = Router();

marketOrderRouter.patch(
  "/orders/:id",
  authRequired,
  validate(marketOrderActionSchema),
  async (req, res, next) => {
    try {
      const orderId = positiveRouteInteger(req.params.id);
      if (!orderId) throw Errors.badRequest("订单 ID 不合法");
      ok(res, await transitionMarketOrder(
        { userId: req.user!.userId, role: req.user!.role },
        orderId,
        req.body as z.infer<typeof marketOrderActionSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);
