import { Router } from "express";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketPayment,
  handleMarketPaymentNotification,
  marketPaymentReturnTarget,
  marketPaySchema,
  MarketPaymentNotificationRejected,
  normalizeMarketPaymentParams,
} from "../services/marketPaymentService";
import { STUDENT_MARKET_PAYMENT_ENABLED } from "../services/marketPolicy";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const marketPaymentRouter = Router();

marketPaymentRouter.post(
  "/orders/:id/pay",
  authRequired,
  validate(marketPaySchema),
  async (req, res, next) => {
    try {
      const orderId = positiveRouteInteger(req.params.id);
      if (!orderId) throw Errors.badRequest("订单 ID 不合法");
      const clientIp = String(
        req.ip || req.socket?.remoteAddress || "",
      ).trim();
      ok(res, await createMarketPayment(
        {
          userId: req.user!.userId,
          role: req.user!.role,
        },
        orderId,
        req.body,
        clientIp,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketPaymentRouter.all("/payments/notify", async (req, res, next) => {
  if (!STUDENT_MARKET_PAYMENT_ENABLED) {
    return res.type("text/plain").status(410).send("disabled");
  }
  try {
    const result = await handleMarketPaymentNotification(
      normalizeMarketPaymentParams({
        ...req.query,
        ...req.body,
      }),
    );
    return res.type("text/plain").status(result.status).send(result.body);
  } catch (error) {
    if (error instanceof MarketPaymentNotificationRejected) {
      return res.type("text/plain").status(400).send("fail");
    }
    return next(error);
  }
});

marketPaymentRouter.get("/payments/return", async (req, res, next) => {
  try {
    const target = await marketPaymentReturnTarget(
      normalizeMarketPaymentParams(req.query),
    );
    return res.redirect(302, target);
  } catch (error) {
    return next(error);
  }
});
