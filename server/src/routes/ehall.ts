import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { ok } from "../utils/response";
import {
  getXjtluEhallLaunchUrl,
  getXjtluEhallNotices,
  getXjtluEhallServices,
  getXjtluEhallStatus,
} from "../services/xjtluEhallClient";
import { getXjtluPortalConnectionStatus } from "../services/xjtluSsoClient";

export const ehallRouter = Router();

ehallRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

ehallRouter.get("/status", async (req, res, next) => {
  try {
    const status = await getXjtluEhallStatus(req.user!.userId);
    if (status.active) return ok(res, status);
    const connection = await getXjtluPortalConnectionStatus(req.user!.userId);
    ok(res, { ...status, connecting: connection.ehall === "connecting" });
  } catch (error) {
    next(error);
  }
});

ehallRouter.get("/services", async (req, res, next) => {
  try {
    ok(res, { services: await getXjtluEhallServices(req.user!.userId) });
  } catch (error) {
    next(error);
  }
});

ehallRouter.get("/notices", async (req, res, next) => {
  try {
    ok(res, await getXjtluEhallNotices(req.user!.userId));
  } catch (error) {
    next(error);
  }
});

ehallRouter.post(
  "/launch",
  validate(z.object({
    serviceId: z.string().trim().min(1).max(128),
    // 兼容仍在浏览器/PWA 缓存中的旧版前端。完整办事大厅返回的都是 item。
    kind: z.enum(["item", "service"]).optional().default("item"),
  })),
  async (req, res, next) => {
    try {
      ok(res, { url: await getXjtluEhallLaunchUrl(req.user!.userId, req.body.serviceId, req.body.kind) });
    } catch (error) {
      next(error);
    }
  },
);
