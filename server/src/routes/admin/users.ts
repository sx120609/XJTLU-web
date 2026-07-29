import { Router, type Request } from "express";
import { adminOnly, modOrAbove } from "../../middleware/admin";
import { validate } from "../../middleware/validate";
import {
  adminUserCreateSchema,
  adminUserListQuerySchema,
  adminUserPasswordSchema,
  adminUserPatchSchema,
  type AdminUserListQuery,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
} from "../../services/adminUserService";
import { positiveRouteInteger } from "../../utils/query";
import { Errors, ok } from "../../utils/response";

export const adminUserRouter = Router();

function actor(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
  };
}

function userId(value: string) {
  const id = positiveRouteInteger(value);
  if (!id) throw Errors.badRequest("用户 ID 不合法");
  return id;
}

adminUserRouter.get(
  "/users",
  modOrAbove,
  validate(adminUserListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      ok(res, await listAdminUsers(
        actor(req),
        req.query as unknown as AdminUserListQuery,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminUserRouter.patch(
  "/users/:id",
  modOrAbove,
  validate(adminUserPatchSchema),
  async (req, res, next) => {
    try {
      ok(res, await updateAdminUser(
        actor(req),
        userId(req.params.id),
        req.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminUserRouter.post(
  "/users",
  adminOnly,
  validate(adminUserCreateSchema),
  async (req, res, next) => {
    try {
      ok(res, await createAdminUser(actor(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

adminUserRouter.patch(
  "/users/:id/password",
  adminOnly,
  validate(adminUserPasswordSchema),
  async (req, res, next) => {
    try {
      ok(res, await resetAdminUserPassword(
        actor(req),
        userId(req.params.id),
        req.body.newPassword,
      ));
    } catch (error) {
      next(error);
    }
  },
);

adminUserRouter.delete(
  "/users/:id",
  adminOnly,
  async (req, res, next) => {
    try {
      ok(res, await deleteAdminUser(actor(req), userId(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);
