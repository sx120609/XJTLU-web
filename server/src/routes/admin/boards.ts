import { Router, type Request } from "express";
import { adminOnly } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminBoardCreateSchema,
  adminBoardPatchSchema,
  adminFeedPatchSchema,
  createAdminBoard,
  deleteAdminBoard,
  listAdminBoards,
  listAdminFeedSources,
  resetAndRunAdminFeedSource,
  runAdminFeedSource,
  runAllAdminFeedSources,
  updateAdminBoard,
  updateAdminFeedSource,
} from "../../services/adminBoardService";
import { positiveRouteInteger } from "../../utils/query";
import { Errors, ok } from "../../utils/response";

export const adminBoardRouter = Router();

function actor(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
  };
}

function routeId(value: string, label: string) {
  const id = positiveRouteInteger(value);
  if (!id) throw Errors.badRequest(`${label} ID 不合法`);
  return id;
}

adminBoardRouter.use(adminOnly);

adminBoardRouter.get("/boards", async (req, res, next) => {
  try {
    ok(res, await listAdminBoards(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminBoardRouter.post(
  "/boards",
  validate(adminBoardCreateSchema),
  async (req, res, next) => {
    try {
      ok(res, await createAdminBoard(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminBoardRouter.patch(
  "/boards/:id",
  validate(adminBoardPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminBoard(
        actor(req),
        routeId(req.params.id, "板块"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminBoardRouter.delete("/boards/:id", async (req, res, next) => {
  try {
    ok(res, await deleteAdminBoard(
      actor(req),
      routeId(req.params.id, "板块"),
    ));
  } catch (error) {
    next(error);
  }
});

adminBoardRouter.get("/feeds", async (req, res, next) => {
  try {
    ok(res, await listAdminFeedSources(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminBoardRouter.patch(
  "/feeds/:id",
  validate(adminFeedPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminFeedSource(
        actor(req),
        routeId(req.params.id, "公告源"),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminBoardRouter.post("/feeds/run-all", async (req, res, next) => {
  try {
    ok(res, await runAllAdminFeedSources(actor(req)));
  } catch (error) {
    next(error);
  }
});

adminBoardRouter.post("/feeds/:id/run", async (req, res, next) => {
  try {
    ok(res, await runAdminFeedSource(
      actor(req),
      routeId(req.params.id, "公告源"),
    ));
  } catch (error) {
    next(error);
  }
});

adminBoardRouter.post("/feeds/:id/reset-run", async (req, res, next) => {
  try {
    ok(res, await resetAndRunAdminFeedSource(
      actor(req),
      routeId(req.params.id, "公告源"),
    ));
  } catch (error) {
    next(error);
  }
});
