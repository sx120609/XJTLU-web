import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { ok } from "../utils/response";
import {
  V1_PRODUCT_SURFACES,
  recordProductActivity,
} from "../services/v1ProductAnalytics";

export const productAnalyticsRouter = Router();

const activitySchema = z.object({
  surface: z.enum(V1_PRODUCT_SURFACES),
  source: z.enum([...V1_PRODUCT_SURFACES, "direct"] as const).default("direct"),
}).strict();

productAnalyticsRouter.post("/activity", validate(activitySchema), async (req, res, next) => {
  try {
    ok(res, await recordProductActivity(req.user!.userId, req.body));
  } catch (error) {
    next(error);
  }
});
