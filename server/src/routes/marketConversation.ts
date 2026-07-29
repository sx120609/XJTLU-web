import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketConversation,
  getMarketOrderContactCards,
  listMarketConversationMessages,
  listMarketConversations,
  marketContactCardSchema,
  marketConversationCreateSchema,
  marketMessageSchema,
  saveMarketContactCard,
  sendMarketConversationMessage,
} from "../services/marketConversationService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";

export const marketConversationRouter = Router();

marketConversationRouter.post(
  "/items/:id/conversations",
  authRequired,
  validate(marketConversationCreateSchema),
  async (req, res, next) => {
    try {
      const itemId = positiveRouteInteger(req.params.id);
      if (!itemId) throw Errors.badRequest("商品 ID 不合法");
      ok(res, await createMarketConversation(
        { userId: req.user!.userId, role: req.user!.role },
        itemId,
        req.body as z.infer<typeof marketConversationCreateSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.get("/conversations", authRequired, async (req, res, next) => {
  try {
    ok(res, await listMarketConversations({
      userId: req.user!.userId,
      role: req.user!.role,
    }));
  } catch (error) {
    next(error);
  }
});

marketConversationRouter.get(
  "/conversations/:id/messages",
  authRequired,
  async (req, res, next) => {
    try {
      const conversationId = positiveRouteInteger(req.params.id);
      if (!conversationId) throw Errors.badRequest("会话 ID 不合法");
      ok(res, await listMarketConversationMessages(
        { userId: req.user!.userId, role: req.user!.role },
        conversationId,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.post(
  "/conversations/:id/messages",
  authRequired,
  validate(marketMessageSchema),
  async (req, res, next) => {
    try {
      const conversationId = positiveRouteInteger(req.params.id);
      if (!conversationId) throw Errors.badRequest("会话 ID 不合法");
      ok(res, await sendMarketConversationMessage(
        { userId: req.user!.userId, role: req.user!.role },
        conversationId,
        req.body as z.infer<typeof marketMessageSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.patch(
  "/contact-card",
  authRequired,
  validate(marketContactCardSchema),
  async (req, res, next) => {
    try {
      ok(res, await saveMarketContactCard(
        { userId: req.user!.userId, role: req.user!.role },
        req.body as z.infer<typeof marketContactCardSchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.get(
  "/orders/:id/contact-cards",
  authRequired,
  async (req, res, next) => {
    try {
      const orderId = positiveRouteInteger(req.params.id);
      if (!orderId) throw Errors.badRequest("订单 ID 不合法");
      ok(res, await getMarketOrderContactCards(
        { userId: req.user!.userId, role: req.user!.role },
        orderId,
      ));
    } catch (error) {
      next(error);
    }
  },
);
