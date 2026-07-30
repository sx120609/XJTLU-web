import { Router } from "express";
import { authOptional, authRequired } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { prisma } from "../../prisma";
import { canManageGradeFeedbackQuestionnaire } from "../../services/gradeCheckService";
import {
  acquireQuestionnaireLock,
  acquireQuestionnaireResponseLock,
} from "../../services/questionnaireLockService";
import {
  normalizeQuestionnaire,
  normalizeResponse,
  parseFields,
  type QuestionnaireField,
} from "../../services/questionnaires";
import {
  assertToolUsable,
  hasToolContentManagePermission,
  isServiceToolCode,
  isSiteAdmin,
  listContentManageableToolCodes,
} from "../../services/serviceTools";
import {
  nextQuestionnaireSlug,
  questionnaireSlugBase,
} from "../../services/toolSlugService";
import { acquireToolSlugLock } from "../../services/toolSlugLockService";
import {
  createQuestionnaireSchema,
  patchQuestionnaireSchema,
  questionnaireResponseSchema,
} from "../../services/toolSchemas";
import { Errors, ok } from "../../utils/response";

export const toolQuestionnairesRouter = Router();

toolQuestionnairesRouter.get("/questionnaires", authOptional, async (req, res, next) => {
  try {
    const requestedToolCode = req.query.toolCode
      ? String(req.query.toolCode)
      : undefined;
    if (requestedToolCode && !isServiceToolCode(requestedToolCode)) {
      throw Errors.badRequest("小工具不合法");
    }
    const toolCode = requestedToolCode && isServiceToolCode(requestedToolCode)
      ? requestedToolCode
      : undefined;
    const includeDraft = req.query.manage === "1";
    if (!includeDraft) {
      ok(res, []);
      return;
    }
    const contentManageCodes = req.user
      ? await listContentManageableToolCodes(req.user)
      : [];
    if (toolCode && !contentManageCodes.includes(toolCode)) {
      throw Errors.forbidden("没有该小工具的管理权限");
    }
    if (!toolCode && !contentManageCodes.length) {
      throw Errors.forbidden("没有小工具管理权限");
    }
    const canSeeAll = isSiteAdmin(req.user?.role);
    const list = await prisma.questionnaire.findMany({
      where: {
        ...(toolCode
          ? { toolCode }
          : { toolCode: { in: contentManageCodes } }),
        ...(canSeeAll ? {} : { createdById: req.user!.userId }),
      },
      orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }],
      include: {
        createdBy: {
          select: { id: true, username: true, nickname: true, role: true },
        },
        _count: { select: { responses: true } },
      },
    });
    ok(
      res,
      list.map((row) =>
        normalizeQuestionnaire(row, {
          includeFields: canManageQuestionnaireRow(row, req.user),
          includeStats: canManageQuestionnaireRow(row, req.user),
        }),
      ),
    );
  } catch (error) {
    next(error);
  }
});

toolQuestionnairesRouter.get(
  "/questionnaires/:slug",
  authOptional,
  async (req, res, next) => {
    try {
      const row = await prisma.questionnaire.findUnique({
        where: { slug: String(req.params.slug) },
        include: {
          createdBy: {
            select: { id: true, username: true, nickname: true, role: true },
          },
          _count: { select: { responses: true } },
        },
      });
      if (!row) throw Errors.notFound("问卷不存在");
      const canManage = await canManageQuestionnaire(row, req.user);
      if (!canManage) {
        await ensureToolUsableForRequest(row.toolCode, req.user);
      }
      if (row.status !== "open" && !canManage) {
        throw Errors.notFound("问卷不存在或未开放");
      }
      if (row.visibility === "login" && !req.user?.userId && !canManage) {
        throw Errors.unauthorized("请先登录后填写");
      }
      ok(res, {
        ...normalizeQuestionnaire(row, {
          includeFields: true,
          includeStats: canManage,
        }),
        canManage,
      });
    } catch (error) {
      next(error);
    }
  },
);

toolQuestionnairesRouter.post(
  "/questionnaires",
  authRequired,
  validate(createQuestionnaireSchema),
  async (req, res, next) => {
    try {
      if (!(await hasToolContentManagePermission(req.body.toolCode, req.user))) {
        throw Errors.forbidden("没有该小工具的管理权限");
      }
      validateFields(req.body.fields);
      const now = new Date();
      const row = await prisma.$transaction(async (tx) => {
        await acquireToolSlugLock(
          tx,
          "questionnaire",
          questionnaireSlugBase(req.body.title),
        );
        return tx.questionnaire.create({
          data: {
            toolCode: req.body.toolCode,
            slug: await nextQuestionnaireSlug(req.body.title, tx),
            title: req.body.title,
            description: req.body.description || null,
            status: req.body.status ?? "draft",
            visibility: req.body.visibility ?? "public",
            allowAnonymous: req.body.allowAnonymous ?? true,
            oneResponsePerUser: req.body.oneResponsePerUser ?? false,
            isSystem: false,
            fields: JSON.stringify(req.body.fields),
            createdById: req.user!.userId,
            publishedAt:
              (req.body.status ?? "draft") === "open" ? now : null,
            closedAt: req.body.status === "closed" ? now : null,
          },
          include: {
            createdBy: {
              select: { id: true, username: true, nickname: true, role: true },
            },
            _count: { select: { responses: true } },
          },
        });
      });
      ok(
        res,
        normalizeQuestionnaire(row, {
          includeFields: true,
          includeStats: true,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

toolQuestionnairesRouter.patch(
  "/questionnaires/:id",
  authRequired,
  validate(patchQuestionnaireSchema),
  async (req, res, next) => {
    try {
      const id = positiveRouteId(req.params.id);
      const current = await prisma.questionnaire.findUnique({ where: { id } });
      if (!current) throw Errors.notFound("问卷不存在");
      if (current.isSystem) throw Errors.badRequest("系统问卷不能编辑");
      if (!(await canManageQuestionnaire(current, req.user))) {
        throw Errors.forbidden("没有该问卷的管理权限");
      }
      const targetToolCode = req.body.toolCode ?? current.toolCode;
      if (
        targetToolCode !== current.toolCode
        && !(await hasToolContentManagePermission(targetToolCode, req.user))
      ) {
        throw Errors.forbidden("没有目标小工具的管理权限");
      }
      if (req.body.fields) validateFields(req.body.fields);
      const now = new Date();
      const row = await prisma.$transaction(async (tx) => {
        await acquireQuestionnaireLock(tx, id);
        const locked = await tx.questionnaire.findUnique({ where: { id } });
        if (!locked) throw Errors.notFound("问卷不存在");
        if (locked.isSystem) throw Errors.badRequest("系统问卷不能编辑");
        if (!(await canManageQuestionnaire(locked, req.user))) {
          throw Errors.forbidden("没有该问卷的管理权限");
        }
        const lockedTargetToolCode = req.body.toolCode ?? locked.toolCode;
        if (
          lockedTargetToolCode !== locked.toolCode
          && !(await hasToolContentManagePermission(
            lockedTargetToolCode,
            req.user,
          ))
        ) {
          throw Errors.forbidden("没有目标小工具的管理权限");
        }
        return tx.questionnaire.update({
          where: { id },
          data: {
            toolCode: req.body.toolCode,
            title: req.body.title,
            description:
              req.body.description === undefined
                ? undefined
                : req.body.description || null,
            status: req.body.status,
            visibility: req.body.visibility,
            allowAnonymous: req.body.allowAnonymous,
            oneResponsePerUser: req.body.oneResponsePerUser,
            fields: req.body.fields
              ? JSON.stringify(req.body.fields)
              : undefined,
            publishedAt:
              req.body.status === "open" && !locked.publishedAt
                ? now
                : undefined,
            closedAt:
              req.body.status === "closed"
                ? now
                : req.body.status === "open"
                  ? null
                  : undefined,
          },
          include: {
            createdBy: {
              select: { id: true, username: true, nickname: true, role: true },
            },
            _count: { select: { responses: true } },
          },
        });
      });
      ok(
        res,
        normalizeQuestionnaire(row, {
          includeFields: true,
          includeStats: true,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

toolQuestionnairesRouter.delete(
  "/questionnaires/:id",
  authRequired,
  async (req, res, next) => {
    try {
      const id = positiveRouteId(req.params.id);
      const current = await prisma.questionnaire.findUnique({ where: { id } });
      if (!current) throw Errors.notFound("问卷不存在");
      if (current.isSystem) throw Errors.badRequest("系统问卷不能删除");
      if (!(await canManageQuestionnaire(current, req.user))) {
        throw Errors.forbidden("没有该问卷的管理权限");
      }
      await prisma.$transaction(async (tx) => {
        await acquireQuestionnaireLock(tx, id);
        const locked = await tx.questionnaire.findUnique({ where: { id } });
        if (!locked) throw Errors.notFound("问卷不存在");
        if (locked.isSystem) throw Errors.badRequest("系统问卷不能删除");
        if (!(await canManageQuestionnaire(locked, req.user))) {
          throw Errors.forbidden("没有该问卷的管理权限");
        }
        await tx.questionnaire.delete({ where: { id } });
      });
      ok(res, { ok: true });
    } catch (error) {
      next(error);
    }
  },
);

toolQuestionnairesRouter.post(
  "/questionnaires/:slug/responses",
  authOptional,
  validate(questionnaireResponseSchema),
  async (req, res, next) => {
    try {
      const row = await prisma.questionnaire.findUnique({
        where: { slug: String(req.params.slug) },
      });
      if (!row) throw Errors.notFound("问卷不存在");
      await ensureToolUsableForRequest(row.toolCode, req.user);
      assertQuestionnaireAcceptsResponse(row, req.user);
      const result = await prisma.$transaction(async (tx) => {
        await acquireQuestionnaireResponseLock(
          tx,
          row.id,
          req.user?.userId,
        );
        const current = await tx.questionnaire.findUnique({
          where: { id: row.id },
        });
        if (!current) throw Errors.notFound("问卷不存在");
        if (current.updatedAt.getTime() !== row.updatedAt.getTime()) {
          throw Errors.conflict("问卷内容刚刚发生变化，请刷新后重新提交");
        }
        assertQuestionnaireAcceptsResponse(current, req.user);
        if (current.oneResponsePerUser && req.user?.userId) {
          const exists = await tx.questionnaireResponse.findFirst({
            where: {
              questionnaireId: current.id,
              respondentId: req.user.userId,
            },
            select: { id: true },
          });
          if (exists) throw Errors.conflict("你已经提交过该问卷");
        }
        const fields = parseFields(current.fields);
        const answers = normalizeAnswers(fields, req.body.answers);
        const response = await tx.questionnaireResponse.create({
          data: {
            questionnaireId: current.id,
            respondentId: req.user?.userId ?? null,
            answers: JSON.stringify(answers),
          },
        });
        return response;
      });
      ok(res, {
        id: result.id,
        createdAt: result.createdAt,
      });
    } catch (error) {
      next(error);
    }
  },
);

toolQuestionnairesRouter.get(
  "/questionnaires/:id/responses",
  authRequired,
  async (req, res, next) => {
    try {
      const id = positiveRouteId(req.params.id);
      const questionnaire = await prisma.questionnaire.findUnique({
        where: { id },
      });
      if (!questionnaire) throw Errors.notFound("问卷不存在");
      if (!(await canManageQuestionnaire(questionnaire, req.user))) {
        throw Errors.forbidden("没有该问卷的管理权限");
      }
      const list = await prisma.questionnaireResponse.findMany({
        where: { questionnaireId: id },
        orderBy: { createdAt: "desc" },
        include: {
          respondent: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar: true,
              role: true,
            },
          },
        },
      });
      ok(res, {
        questionnaire: normalizeQuestionnaire(questionnaire, {
          includeFields: true,
        }),
        list: list.map(normalizeResponse),
      });
    } catch (error) {
      next(error);
    }
  },
);

async function canManageQuestionnaire(
  row: { toolCode: string; slug?: string; createdById: number | null },
  user: Express.Request["user"],
) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  if (
    row.slug
    && await canManageGradeFeedbackQuestionnaire(row.slug, user)
  ) {
    return true;
  }
  return row.createdById === user.userId
    && await hasToolContentManagePermission(row.toolCode, user);
}

function canManageQuestionnaireRow(
  row: { createdById: number | null },
  user: Express.Request["user"],
) {
  if (!user?.userId) return false;
  return isSiteAdmin(user.role) || row.createdById === user.userId;
}

function validateFields(fields: QuestionnaireField[]) {
  const ids = new Set<string>();
  const indexById = new Map<string, number>();
  fields.forEach((field, index) => indexById.set(field.id, index));
  for (const field of fields) {
    if (ids.has(field.id)) {
      throw Errors.badRequest(`字段 ID 重复：${field.id}`);
    }
    ids.add(field.id);
    if (
      (field.type === "single" || field.type === "multiple")
      && (!field.options || field.options.length < 2)
    ) {
      throw Errors.badRequest(`选项题“${field.label}”至少需要 2 个选项`);
    }
    if (field.branching) {
      if (field.type !== "single") {
        throw Errors.badRequest(`只有单选题“${field.label}”可以配置分支`);
      }
      const allowed = new Set(field.options ?? []);
      const fieldIndex = indexById.get(field.id) ?? 0;
      for (const [option, rule] of Object.entries(field.branching)) {
        if (!allowed.has(option)) {
          throw Errors.badRequest(
            `题目“${field.label}”包含不存在的分支选项：${option}`,
          );
        }
        if (rule.action === "jump") {
          if (!rule.targetId) {
            throw Errors.badRequest(
              `题目“${field.label}”的分支缺少跳转目标`,
            );
          }
          const targetIndex = indexById.get(rule.targetId);
          if (targetIndex === undefined || targetIndex <= fieldIndex) {
            throw Errors.badRequest(
              `题目“${field.label}”只能跳转到后面的题目`,
            );
          }
        }
      }
    }
    if (field.type === "rating") {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      if (min < 0 || max > 10 || min >= max) {
        throw Errors.badRequest(`评分题“${field.label}”的分值范围不合法`);
      }
    }
    if (
      field.type === "number"
      && field.min !== undefined
      && field.max !== undefined
      && field.min > field.max
    ) {
      throw Errors.badRequest(
        `数字题“${field.label}”的最小值不能大于最大值`,
      );
    }
  }
}

function activeQuestionnaireFields(
  fields: QuestionnaireField[],
  input: Record<string, string | string[]>,
) {
  const result: QuestionnaireField[] = [];
  const indexById = new Map(fields.map((field, index) => [field.id, index]));
  for (let index = 0; index < fields.length;) {
    const field = fields[index];
    result.push(field);
    if (field.type === "single") {
      const raw = input[field.id];
      const value = Array.isArray(raw) ? "" : String(raw ?? "").trim();
      const rule = value ? field.branching?.[value] : undefined;
      if (rule?.action === "end") break;
      if (rule?.action === "jump" && rule.targetId) {
        const targetIndex = indexById.get(rule.targetId);
        if (targetIndex !== undefined && targetIndex > index) {
          index = targetIndex;
          continue;
        }
      }
    }
    index += 1;
  }
  return result;
}

function normalizeAnswers(
  fields: QuestionnaireField[],
  input: Record<string, string | string[]>,
) {
  const result: Record<string, string | string[]> = {};
  for (const field of activeQuestionnaireFields(fields, input)) {
    const raw = input[field.id];
    if (field.type === "multiple") {
      const values = Array.isArray(raw)
        ? raw.map(String).map((value) => value.trim()).filter(Boolean)
        : [];
      if (field.required && !values.length) {
        throw Errors.badRequest(`请填写：${field.label}`);
      }
      const allowed = new Set(field.options ?? []);
      if (values.some((value) => !allowed.has(value))) {
        throw Errors.badRequest(`“${field.label}”包含无效选项`);
      }
      result[field.id] = values;
      continue;
    }
    const value = Array.isArray(raw) ? "" : String(raw ?? "").trim();
    if (field.required && !value) {
      throw Errors.badRequest(`请填写：${field.label}`);
    }
    if (field.type === "single" && value) {
      const allowed = new Set(field.options ?? []);
      if (!allowed.has(value)) {
        throw Errors.badRequest(`“${field.label}”包含无效选项`);
      }
    }
    if (field.type === "number" && value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw Errors.badRequest(`“${field.label}”需要填写数字`);
      }
      if (field.min !== undefined && numeric < field.min) {
        throw Errors.badRequest(`“${field.label}”不能小于 ${field.min}`);
      }
      if (field.max !== undefined && numeric > field.max) {
        throw Errors.badRequest(`“${field.label}”不能大于 ${field.max}`);
      }
    }
    if (field.type === "rating" && value) {
      const numeric = Number(value);
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
        throw Errors.badRequest(`“${field.label}”评分不合法`);
      }
    }
    if (
      field.type === "date"
      && value
      && !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      throw Errors.badRequest(`“${field.label}”日期格式不合法`);
    }
    const maxLength = field.maxLength
      ?? (field.type === "textarea" ? 2000 : 300);
    result[field.id] = value.slice(
      0,
      Math.max(1, Math.min(maxLength, 2000)),
    );
  }
  return result;
}

function assertQuestionnaireAcceptsResponse(
  questionnaire: {
    status: string;
    visibility: string;
    allowAnonymous: boolean;
  },
  user: Express.Request["user"],
) {
  if (questionnaire.status !== "open") {
    throw Errors.badRequest("问卷当前未开放填写");
  }
  if (
    (questionnaire.visibility === "login" || !questionnaire.allowAnonymous)
    && !user?.userId
  ) {
    throw Errors.unauthorized("请先登录后填写");
  }
}

async function ensureToolUsableForRequest(
  toolCode: string,
  user: Express.Request["user"],
) {
  try {
    await assertToolUsable(toolCode, user);
  } catch (error: any) {
    if (error?.message === "TOOL_LOGIN_REQUIRED") {
      throw Errors.unauthorized("该小工具需要登录后使用");
    }
    if (error?.message === "INVALID_TOOL_CODE") {
      throw Errors.badRequest("小工具不合法");
    }
    throw error;
  }
}

function positiveRouteId(value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw Errors.badRequest("资源 ID 不合法");
  }
  return id;
}
