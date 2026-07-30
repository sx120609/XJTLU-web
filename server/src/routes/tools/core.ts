import { Router } from "express";
import { authOptional, authRequired } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { prisma } from "../../prisma";
import {
  hasToolManagerPermission,
  isServiceToolCode,
  listContentManageableToolCodes,
  listManagerToolCodes,
  listToolSettings,
  managerSelect,
  SERVICE_TOOL_CODES,
  SERVICE_TOOL_META,
  updateToolSetting,
} from "../../services/serviceTools";
import {
  toolManagerCreateSchema,
  toolSettingPatchSchema,
} from "../../services/toolSchemas";
import { Errors, ok } from "../../utils/response";

export const toolCoreRouter = Router();

toolCoreRouter.get("/", authOptional, async (req, res, next) => {
  try {
    const managerCodes = await listManagerToolCodes(req.user);
    const manageableCodes = await listContentManageableToolCodes(req.user);
    const settings = await listToolSettings();
    ok(res, SERVICE_TOOL_CODES.map((code) => ({
      ...SERVICE_TOOL_META[code],
      isVisible: settings.get(code)?.isVisible ?? true,
      requireLogin: settings.get(code)?.requireLogin ?? false,
      allowPublicManage: settings.get(code)?.allowPublicManage ?? false,
      canManage: manageableCodes.includes(code),
      canAdmin: managerCodes.includes(code),
    })));
  } catch (error) {
    next(error);
  }
});

toolCoreRouter.patch(
  "/:toolCode/settings",
  authRequired,
  validate(toolSettingPatchSchema),
  async (req, res, next) => {
    try {
      const toolCode = String(req.params.toolCode);
      if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
      if (!(await hasToolManagerPermission(toolCode, req.user))) {
        throw Errors.forbidden("没有该小工具的管理权限");
      }
      const row = await updateToolSetting(toolCode, {
        isVisible: req.body.isVisible,
        requireLogin: req.body.requireLogin,
        allowPublicManage: req.body.allowPublicManage,
      });
      ok(res, {
        toolCode: row.toolCode,
        isVisible: row.isVisible,
        requireLogin: row.requireLogin,
        allowPublicManage: row.allowPublicManage,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  },
);

toolCoreRouter.get("/permissions/me", authRequired, async (req, res, next) => {
  try {
    const [toolCodes, adminToolCodes] = await Promise.all([
      listContentManageableToolCodes(req.user),
      listManagerToolCodes(req.user),
    ]);
    ok(res, { toolCodes, adminToolCodes });
  } catch (error) {
    next(error);
  }
});

toolCoreRouter.get("/:toolCode/managers", authRequired, async (req, res, next) => {
  try {
    const toolCode = String(req.params.toolCode);
    if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
    if (!(await hasToolManagerPermission(toolCode, req.user))) {
      throw Errors.forbidden("没有该小工具的管理权限");
    }
    const rows = await prisma.toolPermission.findMany({
      where: { toolCode },
      orderBy: [{ createdAt: "desc" }],
      select: managerSelect(),
    });
    ok(res, rows);
  } catch (error) {
    next(error);
  }
});

toolCoreRouter.post(
  "/:toolCode/managers",
  authRequired,
  validate(toolManagerCreateSchema),
  async (req, res, next) => {
    try {
      const toolCode = String(req.params.toolCode);
      if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
      if (!(await hasToolManagerPermission(toolCode, req.user))) {
        throw Errors.forbidden("没有该小工具的管理权限");
      }

      const target = req.body.userId
        ? await prisma.user.findUnique({ where: { id: req.body.userId } })
        : await prisma.user.findUnique({
          where: { username: req.body.username },
        });
      if (!target) throw Errors.notFound("用户不存在");
      if (target.status === "banned") {
        throw Errors.badRequest("不能分配给已封禁用户");
      }

      const row = await prisma.toolPermission.upsert({
        where: { toolCode_userId: { toolCode, userId: target.id } },
        update: { role: "manager" },
        create: { toolCode, userId: target.id, role: "manager" },
        select: managerSelect(),
      });
      ok(res, row);
    } catch (error) {
      next(error);
    }
  },
);

toolCoreRouter.delete(
  "/:toolCode/managers/:userId",
  authRequired,
  async (req, res, next) => {
    try {
      const toolCode = String(req.params.toolCode);
      const userId = Number(req.params.userId);
      if (!isServiceToolCode(toolCode)) throw Errors.notFound("小工具不存在");
      if (!Number.isInteger(userId) || userId <= 0) {
        throw Errors.badRequest("用户 ID 不合法");
      }
      if (!(await hasToolManagerPermission(toolCode, req.user))) {
        throw Errors.forbidden("没有该小工具的管理权限");
      }
      if (userId === req.user!.userId && req.user!.role !== "admin") {
        throw Errors.badRequest("不能移除自己的管理权限");
      }
      await prisma.toolPermission.delete({
        where: { toolCode_userId: { toolCode, userId } },
      }).catch(() => null);
      ok(res, { ok: true });
    } catch (error) {
      next(error);
    }
  },
);
