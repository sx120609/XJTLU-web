import { Router, type Request } from "express";
import { z } from "zod";
import { managementBossOnly, managementPermission, managementRequired } from "../middleware/managementAuth";
import { validate } from "../middleware/validate";
import {
  createManagementAdmin,
  listManagementAccounts,
  listManagementAuditLogs,
  managementAccountCreateSchema,
  managementAccountPasswordSchema,
  managementAccountPatchSchema,
  managementAccountPermissionSchema,
  managementPermissionCatalog,
  replaceManagementAdminPermissions,
  resetManagementAdminPassword,
  revokeManagementAdminSessions,
  updateManagementAdmin,
} from "../services/managementAccountService";
import { ok, Errors } from "../utils/response";

export const managementAccountsRouter = Router();
const positiveId = z.coerce.number().int().positive();

function actor(req: Request) {
  if (!req.management) throw Errors.unauthorized("请先登录管理后台");
  return req.management;
}

function id(value: string) {
  const parsed = positiveId.safeParse(value);
  if (!parsed.success) throw Errors.badRequest("管理账号 ID 不合法");
  return parsed.data;
}

managementAccountsRouter.use(managementRequired);

managementAccountsRouter.get("/permissions", managementBossOnly, (_req, res) => {
  ok(res, managementPermissionCatalog());
});

managementAccountsRouter.get("/accounts", managementBossOnly, async (req, res, next) => {
  try { ok(res, await listManagementAccounts(actor(req))); } catch (error) { next(error); }
});

managementAccountsRouter.post("/accounts", managementBossOnly, validate(managementAccountCreateSchema), async (req, res, next) => {
  try { ok(res, await createManagementAdmin(actor(req), req.body, req.ip || "")); } catch (error) { next(error); }
});

managementAccountsRouter.patch("/accounts/:id", managementBossOnly, validate(managementAccountPatchSchema), async (req, res, next) => {
  try { ok(res, await updateManagementAdmin(actor(req), id(req.params.id), req.body, req.ip || "")); } catch (error) { next(error); }
});

managementAccountsRouter.patch("/accounts/:id/password", managementBossOnly, validate(managementAccountPasswordSchema), async (req, res, next) => {
  try { ok(res, await resetManagementAdminPassword(actor(req), id(req.params.id), req.body.newPassword, req.ip || "")); } catch (error) { next(error); }
});

managementAccountsRouter.put("/accounts/:id/permissions", managementBossOnly, validate(managementAccountPermissionSchema), async (req, res, next) => {
  try { ok(res, await replaceManagementAdminPermissions(actor(req), id(req.params.id), req.body, req.ip || "")); } catch (error) { next(error); }
});

managementAccountsRouter.post("/accounts/:id/revoke-sessions", managementBossOnly, async (req, res, next) => {
  try { ok(res, await revokeManagementAdminSessions(actor(req), id(req.params.id), req.ip || "")); } catch (error) { next(error); }
});

managementAccountsRouter.get("/audit", managementPermission("audit.read"), async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(100_000, Number(req.query.page || 1)));
    const size = Math.max(10, Math.min(100, Number(req.query.size || 30)));
    ok(res, await listManagementAuditLogs(actor(req), page, size));
  } catch (error) { next(error); }
});
