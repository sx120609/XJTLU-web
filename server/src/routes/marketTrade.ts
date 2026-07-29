import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createLegacyMarketOffer,
  createMarketTradeIntent,
  marketOfferInputSchema,
  marketTradeActionSchema,
  marketTradeIntentInputSchema,
  transitionLegacyMarketOffer,
  transitionMarketTradeIntent,
} from "../services/marketTradeService";
import { Errors, ok } from "../utils/response";
import { positiveRouteInteger } from "../utils/query";

export const marketTradeRouter = Router();

marketTradeRouter.post(
  "/items/:id/intents",
  authRequired,
  validate(marketTradeIntentInputSchema),
  async (req, res, next) => {
    try {
      const itemId = positiveRouteInteger(req.params.id);
      if (!itemId) throw Errors.badRequest("商品 ID 不合法");
      ok(res, await createMarketTradeIntent(
        { userId: req.user!.userId, role: req.user!.role },
        itemId,
        req.body as z.infer<typeof marketTradeIntentInputSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketTradeRouter.patch(
  "/trade-intents/:id",
  authRequired,
  validate(marketTradeActionSchema),
  async (req, res, next) => {
    try {
      const intentId = positiveRouteInteger(req.params.id);
      if (!intentId) throw Errors.badRequest("购买意向 ID 不合法");
      ok(res, await transitionMarketTradeIntent(
        { userId: req.user!.userId, role: req.user!.role },
        intentId,
        req.body.action,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketTradeRouter.post(
  "/items/:id/offers",
  authRequired,
  validate(marketOfferInputSchema),
  async (req, res, next) => {
    try {
      const itemId = positiveRouteInteger(req.params.id);
      if (!itemId) throw Errors.badRequest("商品 ID 不合法");
      ok(res, await createLegacyMarketOffer(
        { userId: req.user!.userId, role: req.user!.role },
        itemId,
        req.body as z.infer<typeof marketOfferInputSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketTradeRouter.patch(
  "/offers/:id",
  authRequired,
  validate(marketTradeActionSchema),
  async (req, res, next) => {
    try {
      const offerId = positiveRouteInteger(req.params.id);
      if (!offerId) throw Errors.badRequest("购买意向 ID 不合法");
      ok(res, await transitionLegacyMarketOffer(
        { userId: req.user!.userId, role: req.user!.role },
        offerId,
        req.body.action,
      ));
    } catch (error) {
      next(error);
    }
  },
);
