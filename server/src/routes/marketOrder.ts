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
import { recordMarketOrderSystemEvent } from "../services/marketConversationService";

export const marketOrderRouter = Router();

marketOrderRouter.patch(
  "/orders/:id",
  authRequired,
  validate(marketOrderActionSchema),
  async (req, res, next) => {
    try {
      const orderId = positiveRouteInteger(req.params.id);
      if (!orderId) throw Errors.badRequest("订单 ID 不合法");
      const result = await transitionMarketOrder(
        { userId: req.user!.userId, role: req.user!.role },
        orderId,
        req.body as z.infer<typeof marketOrderActionSchema>,
      );
      if (["buyer_confirm", "seller_confirm", "cancel"].includes(req.body.action)) {
        await recordMarketOrderSystemEvent(
          orderId,
          req.user!.userId,
          req.body.action,
          result.status,
        );
      }
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);
