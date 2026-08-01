import type { NextFunction, Request, Response } from "express";
import { Errors } from "../utils/response";
import { managementAuthRequired, requireManagementPermission } from "../services/managementAuthService";
import type { ManagementPermission } from "../services/managementPermissions";

export async function managementRequired(req: Request, _res: Response, next: NextFunction) {
  try {
    await managementAuthRequired(req);
    next();
  } catch (error) {
    next(error);
  }
}

export function managementPermission(permission: ManagementPermission) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.management) throw Errors.unauthorized("请先登录管理后台");
      await requireManagementPermission(req.management, permission);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function managementBossOnly(req: Request, _res: Response, next: NextFunction) {
  if (!req.management) return next(Errors.unauthorized("请先登录管理后台"));
  if (req.management.accountType !== "boss") {
    return next(Errors.forbidden("仅 BOSS 可以管理管理员账号和权限"));
  }
  next();
}
