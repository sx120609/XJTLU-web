import { Router, type Request } from "express";
import { z } from "zod";
import { managementPermission, managementRequired } from "../middleware/managementAuth";
import { validate } from "../middleware/validate";
import {
  adminUserListQuerySchema,
  adminUserPasswordSchema,
  assertPersonalUserTarget,
  deleteAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
} from "../services/adminUserService";
import { recordManagementAudit } from "../services/managementAccountService";
import { requireManagementPermission } from "../services/managementAuthService";
import { Errors, ok } from "../utils/response";

export const managementUsersRouter = Router();

const userIdSchema = z.coerce.number().int().positive();
const managementUserPatchSchema = z.object({
  status: z.enum(["active", "banned", "muted"]).optional(),
  nickname: z.string().trim().min(1).max(20).optional(),
  major: z.string().trim().max(80).optional(),
  aiReviewWhitelisted: z.boolean().optional(),
  mutedUntil: z.string().trim().max(64).nullable().optional(),
  anonymousCredits: z.number().int().min(0).max(999).optional(),
  anonymousCreditsFrozen: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少需要提供一个修改字段");

function actor(req: Request) {
  if (!req.management) throw Errors.unauthorized("请先登录管理后台");
  return req.management;
}

function id(value: string) {
  const parsed = userIdSchema.safeParse(value);
  if (!parsed.success) throw Errors.badRequest("用户 ID 不合法");
  return parsed.data;
}

function legacyActor(req: Request) {
  const principal = actor(req);
  return { userId: -principal.adminAccountId, role: "admin" };
}

managementUsersRouter.use(managementRequired);

managementUsersRouter.get(
  "/users",
  managementPermission("users.read"),
  validate(adminUserListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = {
        ...(req.query as any),
        role: "user",
      };
      ok(res, await listAdminUsers(legacyActor(req), query));
    } catch (error) { next(error); }
  },
);

managementUsersRouter.patch(
  "/users/:id",
  validate(managementUserPatchSchema),
  async (req, res, next) => {
    try {
      const principal = actor(req);
      await assertPersonalUserTarget(id(req.params.id));
      const patch = req.body;
      const sensitive = patch.aiReviewWhitelisted !== undefined
        || patch.anonymousCredits !== undefined
        || patch.anonymousCreditsFrozen !== undefined;
      await requireManagementPermission(principal, sensitive ? "users.sensitive" : "users.moderate");
      const result = await updateAdminUser(legacyActor(req), id(req.params.id), patch);
      await recordManagementAudit(principal, "management.user.update", "user", id(req.params.id), "更新个人用户", patch, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementUsersRouter.patch(
  "/users/:id/password",
  managementPermission("users.sensitive"),
  validate(adminUserPasswordSchema),
  async (req, res, next) => {
    try {
      const principal = actor(req);
      const userId = id(req.params.id);
      await assertPersonalUserTarget(userId);
      const result = await resetAdminUserPassword(legacyActor(req), userId, req.body.newPassword);
      await recordManagementAudit(principal, "management.user.password_reset", "user", userId, "重置个人用户密码", {}, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);

managementUsersRouter.delete(
  "/users/:id",
  managementPermission("users.sensitive"),
  async (req, res, next) => {
    try {
      const principal = actor(req);
      const userId = id(req.params.id);
      await assertPersonalUserTarget(userId);
      const result = await deleteAdminUser(legacyActor(req), userId);
      await recordManagementAudit(principal, "management.user.delete", "user", userId, "删除个人用户", result, req.ip || "");
      ok(res, result);
    } catch (error) { next(error); }
  },
);
