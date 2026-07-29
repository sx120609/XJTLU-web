import { Router, type Request } from "express";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  closeSponsorOrder,
  createSponsorOrder,
  getSponsorOrder,
  getSponsorPaymentOptions,
  getSponsorWall,
  handleSponsorPaymentNotification,
  listSponsorOrders,
  normalizeSponsorPaymentParams,
  retrySponsorPayment,
  sponsorCreateSchema,
  sponsorOrderListQuerySchema,
  sponsorOrderParamsSchema,
  sponsorPaymentReturnTarget,
  SponsorPaymentNotificationRejected,
} from "../services/sponsorPaymentService";
import { ok } from "../utils/response";

export const paymentsRouter = Router();

function actor(req: Request) {
  return { userId: req.user!.userId };
}

paymentsRouter.get(
  "/sponsor/options",
  authRequired,
  async (_req, res, next) => {
    try {
      ok(res, await getSponsorPaymentOptions());
    } catch (error) {
      next(error);
    }
  },
);

paymentsRouter.post(
  "/sponsor/orders",
  authRequired,
  validate(sponsorCreateSchema),
  async (req, res, next) => {
    try {
      ok(res, await createSponsorOrder(actor(req), req.body, req.ip || ""));
    } catch (error) {
      next(error);
    }
  },
);

paymentsRouter.get(
  "/sponsor/orders",
  authRequired,
  validate(sponsorOrderListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listSponsorOrders(actor(req), req.query));
    } catch (error) {
      next(error);
    }
  },
);

paymentsRouter.get(
  "/sponsor/orders/:outTradeNo",
  authRequired,
  validate(sponsorOrderParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(
        res,
        await getSponsorOrder(actor(req), req.params.outTradeNo),
      );
    } catch (error) {
      next(error);
    }
  },
);

paymentsRouter.post(
  "/sponsor/orders/:outTradeNo/pay",
  authRequired,
  validate(sponsorOrderParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(
        res,
        await retrySponsorPayment(
          actor(req),
          req.params.outTradeNo,
          req.ip || "",
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

paymentsRouter.post(
  "/sponsor/orders/:outTradeNo/close",
  authRequired,
  validate(sponsorOrderParamsSchema, "params"),
  async (req, res, next) => {
    try {
      ok(
        res,
        await closeSponsorOrder(actor(req), req.params.outTradeNo),
      );
    } catch (error) {
      next(error);
    }
  },
);

paymentsRouter.get("/sponsor/wall", async (_req, res, next) => {
  try {
    ok(res, await getSponsorWall());
  } catch (error) {
    next(error);
  }
});

paymentsRouter.all("/epay/notify", async (req, res, next) => {
  try {
    const params = normalizeSponsorPaymentParams({
      ...req.query,
      ...req.body,
    });
    const result = await handleSponsorPaymentNotification(params);
    res.type("text/plain").status(result.status).send(result.body);
  } catch (error) {
    if (error instanceof SponsorPaymentNotificationRejected) {
      res.type("text/plain").status(400).send("fail");
      return;
    }
    next(error);
  }
});

paymentsRouter.get("/epay/return", async (req, res, next) => {
  try {
    const params = normalizeSponsorPaymentParams(req.query);
    res.redirect(302, await sponsorPaymentReturnTarget(params));
  } catch (error) {
    next(error);
  }
});
