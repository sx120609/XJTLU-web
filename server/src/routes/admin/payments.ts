import { Router, type Request } from "express";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminEpayConfigPatchSchema,
  adminEpayPreviewSchema,
  adminSponsorConfigPatchSchema,
  adminSponsorLogsQuerySchema,
  adminSponsorOrderListQuerySchema,
  adminSponsorOrderParamsSchema,
  adminSponsorOrderPatchSchema,
  getAdminEpayConfig,
  getAdminSponsorConfig,
  getAdminSponsorOverview,
  listAdminSponsorLogs,
  listAdminSponsorOrders,
  previewAdminEpayPayment,
  updateAdminEpayConfig,
  updateAdminSponsorConfig,
  updateAdminSponsorOrder,
} from "../../services/adminPaymentService";
import { ok } from "../../utils/response";

export const adminPaymentRouter = Router();

function actor(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
    ip: req.ip,
  };
}

adminPaymentRouter.use(adminOnly);

adminPaymentRouter.get("/epay-config", async (req, res, next) => {
  try {
    ok(res, await getAdminEpayConfig(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminPaymentRouter.patch(
  "/epay-config",
  validate(adminEpayConfigPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminEpayConfig(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminPaymentRouter.post(
  "/epay-config/preview",
  validate(adminEpayPreviewSchema),
  async (req, res, next) => {
    try {
      ok(res, await previewAdminEpayPayment(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminPaymentRouter.get("/sponsor-config", async (req, res, next) => {
  try {
    ok(res, await getAdminSponsorConfig(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminPaymentRouter.patch(
  "/sponsor-config",
  validate(adminSponsorConfigPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminSponsorConfig(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminPaymentRouter.get("/sponsor-overview", async (req, res, next) => {
  try {
    ok(res, await getAdminSponsorOverview(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminPaymentRouter.get(
  "/sponsor-orders",
  validate(adminSponsorOrderListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminSponsorOrders(actor(req), req.query));
    } catch (error) {
      next(error);
    }
  },
);

adminPaymentRouter.patch(
  "/sponsor-orders/:id",
  validate(adminSponsorOrderParamsSchema, "params"),
  validate(adminSponsorOrderPatchSchema),
  async (req, res, next) => {
    try {
      ok(
        res,
        await updateAdminSponsorOrder(
          actor(req),
          Number(req.params.id),
          req.body,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

adminPaymentRouter.get(
  "/sponsor-logs",
  validate(adminSponsorLogsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminSponsorLogs(actor(req), req.query));
    } catch (error) {
      next(error);
    }
  },
);
