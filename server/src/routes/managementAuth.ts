import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { managementRequired } from "../middleware/managementAuth";
import {
  loginManagementAccount,
  getManagementSessionView,
  revokeAllManagementSessions,
  revokeManagementSession,
} from "../services/managementAuthService";
import { ok } from "../utils/response";
import { enforceManagementLoginRateLimit } from "../services/managementLoginRateLimit";

export const managementAuthRouter = Router();

const loginSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(1).max(128),
  otp: z.string().trim().regex(/^\d{6}$/).optional(),
}).strict();

managementAuthRouter.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    await enforceManagementLoginRateLimit(req, req.body.username);
    ok(res, await loginManagementAccount(req.body.username, req.body.password, req.body.otp, req));
  } catch (error) { next(error); }
});

managementAuthRouter.get("/me", managementRequired, async (req, res, next) => {
  try {
    ok(res, await getManagementSessionView(req.management!));
  } catch (error) { next(error); }
});

managementAuthRouter.post("/logout", managementRequired, async (req, res, next) => {
  try {
    await revokeManagementSession(req.management!.sessionId, req.management!.adminAccountId);
    ok(res, { ok: true as const });
  } catch (error) { next(error); }
});

managementAuthRouter.post("/logout-all", managementRequired, async (req, res, next) => {
  try {
    const count = await revokeAllManagementSessions(req.management!.adminAccountId);
    ok(res, { ok: true as const, revoked: count });
  } catch (error) { next(error); }
});
