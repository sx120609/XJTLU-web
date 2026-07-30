import { Router } from "express";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  getPointPromotionContext,
  pointPromotionConfig,
  pointPromotionTargetSchema,
  pointPromotionUnavailable,
} from "../services/pointPromotionService";
import { getTransactionPointSummary } from "../services/transactionPoints";
import { prisma } from "../prisma";
import { ok } from "../utils/response";

export const marketPointsRouter = Router();

marketPointsRouter.get("/points", authRequired, async (req, res, next) => {
  try {
    ok(res, await getTransactionPointSummary(prisma, req.user!.userId, true));
  } catch (error) {
    next(error);
  }
});

marketPointsRouter.post(
  "/points/boosts",
  authRequired,
  async (req, res, next) => {
    try {
      pointPromotionUnavailable();
    } catch (error) {
      next(error);
    }
  },
);

marketPointsRouter.get("/points/promotion/config", authRequired, (_req, res) => {
  ok(res, pointPromotionConfig);
});

marketPointsRouter.get(
  "/points/promotion/context",
  authRequired,
  validate(pointPromotionTargetSchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await getPointPromotionContext(req.user!.userId, req.query as any));
    } catch (error) {
      next(error);
    }
  },
);

marketPointsRouter.post(
  "/points/promotion/quote",
  authRequired,
  validate(pointPromotionTargetSchema),
  (_req, _res, next) => {
    try {
      pointPromotionUnavailable();
    } catch (error) {
      next(error);
    }
  },
);

marketPointsRouter.post(
  "/points/promotion/orders",
  authRequired,
  validate(pointPromotionTargetSchema),
  (_req, _res, next) => {
    try {
      pointPromotionUnavailable();
    } catch (error) {
      next(error);
    }
  },
);
