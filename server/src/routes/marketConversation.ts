import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createMarketConversation,
  confirmMarketConversationCompletion,
  getMarketConversationUnreadSummary,
  listMarketConversationMessages,
  listMarketConversations,
  markMarketConversationRead,
  marketConversationCreateSchema,
  marketConversationQuerySchema,
  marketMessageSchema,
  marketMessageQuerySchema,
  marketMessageReportSchema,
  reportMarketConversationMessage,
  sendMarketConversationMessage,
  toggleMarketConversationBlock,
} from "../services/marketConversationService";
import { positiveRouteInteger } from "../utils/query";
import { Errors, ok } from "../utils/response";
import { openMarketChatEventStream } from "../services/marketChatEvents";

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

marketConversationRouter.get("/conversations/events", authRequired, (req, res) => {
  openMarketChatEventStream(req.user!.userId, req, res);
});

marketConversationRouter.get(
  "/conversations",
  authRequired,
  validate(marketConversationQuerySchema, "query"),
  async (req, res, next) => {
  try {
    ok(res, await listMarketConversations({
      userId: req.user!.userId,
      role: req.user!.role,
    }, req.query as unknown as z.infer<typeof marketConversationQuerySchema>));
  } catch (error) {
    next(error);
  }
  },
);

marketConversationRouter.get(
  "/conversations/unread-count",
  authRequired,
  async (req, res, next) => {
    try {
      ok(res, await getMarketConversationUnreadSummary({
        userId: req.user!.userId,
        role: req.user!.role,
      }));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.post(
  "/conversations/:id/confirm-completion",
  authRequired,
  async (req, res, next) => {
    try {
      const conversationId = positiveRouteInteger(req.params.id);
      if (!conversationId) throw Errors.badRequest("会话 ID 不合法");
      ok(res, await confirmMarketConversationCompletion(
        { userId: req.user!.userId, role: req.user!.role },
        conversationId,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.get(
  "/conversations/:id/messages",
  authRequired,
  validate(marketMessageQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const conversationId = positiveRouteInteger(req.params.id);
      if (!conversationId) throw Errors.badRequest("会话 ID 不合法");
      ok(res, await listMarketConversationMessages(
        { userId: req.user!.userId, role: req.user!.role },
        conversationId,
        req.query as unknown as z.infer<typeof marketMessageQuerySchema>,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.post(
  "/conversations/:id/read",
  authRequired,
  async (req, res, next) => {
    try {
      const conversationId = positiveRouteInteger(req.params.id);
      if (!conversationId) throw Errors.badRequest("会话 ID 不合法");
      ok(res, await markMarketConversationRead(
        { userId: req.user!.userId, role: req.user!.role },
        conversationId,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.post(
  "/conversations/:id/block",
  authRequired,
  async (req, res, next) => {
    try {
      const conversationId = positiveRouteInteger(req.params.id);
      if (!conversationId) throw Errors.badRequest("会话 ID 不合法");
      ok(res, await toggleMarketConversationBlock(
        { userId: req.user!.userId, role: req.user!.role },
        conversationId,
      ));
    } catch (error) {
      next(error);
    }
  },
);

marketConversationRouter.post(
  "/conversations/:id/messages/:messageId/report",
  authRequired,
  validate(marketMessageReportSchema),
  async (req, res, next) => {
    try {
      const conversationId = positiveRouteInteger(req.params.id);
      const messageId = positiveRouteInteger(req.params.messageId);
      if (!conversationId || !messageId) throw Errors.badRequest("会话或消息 ID 不合法");
      ok(res, await reportMarketConversationMessage(
        { userId: req.user!.userId, role: req.user!.role },
        conversationId,
        messageId,
        req.body as z.infer<typeof marketMessageReportSchema>,
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
