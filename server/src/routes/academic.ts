import { Router } from "express";
import { ok } from "../utils/response";
import {
  getXjtluAcademicOverview,
  getXjtluAcademicSchedule,
  getXjtluEbridgeStatus,
} from "../services/xjtluEbridgeClient";
import { getXjtluPortalConnectionStatus } from "../services/xjtluSsoClient";

export const academicRouter = Router();

function forceRefresh(value: unknown) {
  return value === "1" || value === "true";
}

academicRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

academicRouter.get("/status", async (req, res, next) => {
  try {
    const status = await getXjtluEbridgeStatus(req.user!.userId, forceRefresh(req.query.refresh));
    if (status.active) return ok(res, status);
    const connection = await getXjtluPortalConnectionStatus(req.user!.userId);
    ok(res, { ...status, connecting: connection.ebridge === "connecting" });
  } catch (error) {
    next(error);
  }
});

academicRouter.get("/overview", async (req, res, next) => {
  try {
    ok(res, await getXjtluAcademicOverview(req.user!.userId));
  } catch (error) {
    next(error);
  }
});

academicRouter.get("/schedule", async (req, res, next) => {
  try {
    ok(res, await getXjtluAcademicSchedule(req.user!.userId));
  } catch (error) {
    next(error);
  }
});
