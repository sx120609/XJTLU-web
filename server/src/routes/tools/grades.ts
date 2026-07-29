import { Router } from "express";
import { authRequired } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { prisma } from "../../prisma";
import {
  buildGradeCheckFeedbackFields,
  canManageGradeCheckTable,
  ensureGradeCheckFeedbackQuestionnaire,
  gradeFeedbackStatus,
  normalizeGradeCheckInput,
  normalizeGradeCheckTable,
  normalizeStudentId,
  parseGradeColumns,
  parseGradePayload,
} from "../../services/gradeCheckService";
import { acquireGradeCheckLock } from "../../services/gradeCheckLockService";
import { acquireQuestionnaireLock } from "../../services/questionnaireLockService";
import {
  assertToolUsable,
  hasToolContentManagePermission,
  isSiteAdmin,
} from "../../services/serviceTools";
import {
  gradeCheckSlugBase,
  nextGradeCheckSlug,
  nextQuestionnaireSlug,
  questionnaireSlugBase,
} from "../../services/toolSlugService";
import { acquireToolSlugLock } from "../../services/toolSlugLockService";
import {
  createGradeCheckSchema,
  patchGradeCheckSchema,
} from "../../services/toolSchemas";
import { notifyGradeCheckLookupForQqBot } from "../../services/toolQqReminders";
import { Errors, ok } from "../../utils/response";

export const toolGradesRouter = Router();

toolGradesRouter.get("/grade-checks", authRequired, async (req, res, next) => {
  try {
    if (req.query.manage !== "1") {
      ok(res, []);
      return;
    }
    if (!(await hasToolContentManagePermission("grade_check", req.user))) {
      throw Errors.forbidden("没有该小工具的管理权限");
    }
    const canSeeAll = isSiteAdmin(req.user?.role);
    const list = await prisma.gradeCheckTable.findMany({
      where: canSeeAll ? {} : { createdById: req.user!.userId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        createdBy: {
          select: { id: true, username: true, nickname: true, role: true },
        },
      },
    });
    ok(res, list.map(normalizeGradeCheckTable));
  } catch (error) {
    next(error);
  }
});

toolGradesRouter.get("/grade-checks/related", authRequired, async (req, res, next) => {
  try {
    await ensureToolUsableForRequest("grade_check", req.user);
    const studentId = normalizeStudentId(req.user!.studentId);
    const rows = await prisma.gradeCheckRow.findMany({
      where: {
        studentId,
        table: { status: "open" },
      },
      include: {
        table: {
          include: {
            createdBy: {
              select: { id: true, username: true, nickname: true, role: true },
            },
          },
        },
      },
    });
    ok(
      res,
      rows
        .map((row) => normalizeGradeCheckTable(row.table))
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
        ),
    );
  } catch (error) {
    next(error);
  }
});

toolGradesRouter.get("/grade-checks/:slug", authRequired, async (req, res, next) => {
  try {
    const table = await prisma.gradeCheckTable.findUnique({
      where: { slug: String(req.params.slug) },
      include: {
        createdBy: {
          select: { id: true, username: true, nickname: true, role: true },
        },
      },
    });
    if (!table) throw Errors.notFound("查询表不存在");
    const canManage = await canManageGradeCheckTable(table, req.user);
    if (!canManage) await ensureToolUsableForRequest("grade_check", req.user);
    if (table.status !== "open" && !canManage) {
      throw Errors.notFound("查询表不存在或未开放");
    }

    const studentId = normalizeStudentId(req.user!.studentId);
    const row = await prisma.gradeCheckRow.findUnique({
      where: {
        tableId_studentId: {
          tableId: table.id,
          studentId,
        },
      },
    });
    const feedbackQuestionnaireSlug = row
      ? await ensureGradeCheckFeedbackQuestionnaire(table)
      : table.feedbackQuestionnaireSlug;
    if (row) {
      await notifyGradeCheckLookupForQqBot({
        table,
        studentId,
        actorUserId: req.user!.userId,
      }).catch((error) => {
        console.warn("[tools] grade check qqbot reminder failed", error);
      });
    }
    ok(res, {
      table: normalizeGradeCheckTable(table),
      studentId,
      row: row ? parseGradePayload(row.payload) : null,
      feedbackQuestionnaireSlug,
      canManage,
    });
  } catch (error) {
    next(error);
  }
});

toolGradesRouter.post(
  "/grade-checks",
  authRequired,
  validate(createGradeCheckSchema),
  async (req, res, next) => {
    try {
      if (!(await hasToolContentManagePermission("grade_check", req.user))) {
        throw Errors.forbidden("没有该小工具的管理权限");
      }
      const normalized = normalizeGradeCheckInput(req.body);
      const now = new Date();
      const row = await prisma.$transaction(async (tx) => {
        const gradeSlugBase = gradeCheckSlugBase(req.body.title);
        await acquireToolSlugLock(tx, "grade-check", gradeSlugBase);
        const created = await tx.gradeCheckTable.create({
          data: {
            slug: await nextGradeCheckSlug(req.body.title, tx),
            title: req.body.title,
            description: req.body.description || null,
            status: req.body.status ?? "open",
            studentIdColumn: normalized.studentIdColumn,
            columns: JSON.stringify(normalized.columns),
            rowCount: normalized.rows.length,
            createdById: req.user!.userId,
            publishedAt: (req.body.status ?? "open") === "open" ? now : null,
            closedAt: req.body.status === "closed" ? now : null,
          },
        });
        const feedbackTitle = `${req.body.title} 问题反馈`;
        await acquireToolSlugLock(
          tx,
          "questionnaire",
          questionnaireSlugBase(feedbackTitle),
        );
        const feedbackSlug = await nextQuestionnaireSlug(feedbackTitle, tx);
        await tx.questionnaire.create({
          data: {
            toolCode: "questionnaire",
            slug: feedbackSlug,
            title: feedbackTitle,
            description:
              "如成绩或个人信息存在问题，请在这里提交说明，发起者会在结果中查看。",
            status: gradeFeedbackStatus(req.body.status ?? "open"),
            visibility: "login",
            allowAnonymous: false,
            oneResponsePerUser: false,
            isSystem: false,
            fields: JSON.stringify(
              buildGradeCheckFeedbackFields(
                normalized.columns,
                normalized.studentIdColumn,
              ),
            ),
            createdById: req.user!.userId,
            publishedAt: (req.body.status ?? "open") === "open" ? now : null,
            closedAt: req.body.status === "closed" ? now : null,
          },
        });
        await tx.gradeCheckTable.update({
          where: { id: created.id },
          data: { feedbackQuestionnaireSlug: feedbackSlug },
        });
        await tx.gradeCheckRow.createMany({
          data: normalized.rows.map((item) => ({
            tableId: created.id,
            studentId: item.studentId,
            payload: JSON.stringify(item.payload),
          })),
        });
        return tx.gradeCheckTable.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            createdBy: {
              select: { id: true, username: true, nickname: true, role: true },
            },
          },
        });
      });
      ok(res, normalizeGradeCheckTable(row));
    } catch (error) {
      next(error);
    }
  },
);

toolGradesRouter.patch(
  "/grade-checks/:id",
  authRequired,
  validate(patchGradeCheckSchema),
  async (req, res, next) => {
    try {
      const id = positiveRouteId(req.params.id);
      const current = await prisma.gradeCheckTable.findUnique({ where: { id } });
      if (!current) throw Errors.notFound("查询表不存在");
      if (!(await canManageGradeCheckTable(current, req.user))) {
        throw Errors.forbidden("没有该查询表的管理权限");
      }

      const hasRows = Boolean(
        req.body.rows || req.body.columns || req.body.studentIdColumn,
      );
      if (hasRows && !req.body.rows) {
        throw Errors.badRequest("更新行列时需要重新上传完整数据");
      }
      const normalized = hasRows
        ? normalizeGradeCheckInput({
            studentIdColumn:
              req.body.studentIdColumn ?? current.studentIdColumn,
            columns: req.body.columns ?? parseGradeColumns(current.columns),
            rows: req.body.rows ?? [],
          })
        : null;

      const now = new Date();
      const row = await prisma.$transaction(async (tx) => {
        await acquireGradeCheckLock(tx, id);
        const locked = await tx.gradeCheckTable.findUnique({ where: { id } });
        if (!locked) throw Errors.notFound("查询表不存在");
        if (
          !isSiteAdmin(req.user?.role)
          && locked.createdById !== req.user!.userId
        ) {
          throw Errors.forbidden("没有该查询表的管理权限");
        }
        if (locked.updatedAt.getTime() !== current.updatedAt.getTime()) {
          throw Errors.conflict("查询表刚刚发生变化，请刷新后重试");
        }
        if (locked.feedbackQuestionnaireSlug) {
          const feedback = await tx.questionnaire.findUnique({
            where: { slug: locked.feedbackQuestionnaireSlug },
            select: { id: true },
          });
          if (feedback) await acquireQuestionnaireLock(tx, feedback.id);
        }
        const updated = await tx.gradeCheckTable.update({
          where: { id },
          data: {
            title: req.body.title,
            description:
              req.body.description === undefined
                ? undefined
                : req.body.description || null,
            status: req.body.status,
            studentIdColumn: normalized?.studentIdColumn,
            columns: normalized
              ? JSON.stringify(normalized.columns)
              : undefined,
            rowCount: normalized?.rows.length,
            feedbackQuestionnaireSlug: normalized ? null : undefined,
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
        });
        if (normalized) {
          await tx.gradeCheckRow.deleteMany({ where: { tableId: id } });
          await tx.gradeCheckRow.createMany({
            data: normalized.rows.map((item) => ({
              tableId: id,
              studentId: item.studentId,
              payload: JSON.stringify(item.payload),
            })),
          });
        }
        const refreshed = await tx.gradeCheckTable.findUniqueOrThrow({
          where: { id: updated.id },
          include: {
            createdBy: {
              select: { id: true, username: true, nickname: true, role: true },
            },
          },
        });
        if (normalized) {
          const feedbackTitle = `${refreshed.title} 问题反馈`;
          await acquireToolSlugLock(
            tx,
            "questionnaire",
            questionnaireSlugBase(feedbackTitle),
          );
          const slug = await nextQuestionnaireSlug(feedbackTitle, tx);
          await tx.questionnaire.create({
            data: {
              toolCode: "questionnaire",
              slug,
              title: feedbackTitle,
              description: "如核对项目存在问题，请提交说明。",
              status: gradeFeedbackStatus(refreshed.status),
              visibility: "login",
              allowAnonymous: false,
              oneResponsePerUser: false,
              isSystem: false,
              fields: JSON.stringify(
                buildGradeCheckFeedbackFields(
                  normalized.columns,
                  normalized.studentIdColumn,
                ),
              ),
              createdById: refreshed.createdById,
              publishedAt: refreshed.status === "open" ? now : null,
              closedAt: refreshed.status === "closed" ? now : null,
            },
          });
          const rowWithFeedback = await tx.gradeCheckTable.update({
            where: { id: updated.id },
            data: { feedbackQuestionnaireSlug: slug },
            include: {
              createdBy: {
                select: { id: true, username: true, nickname: true, role: true },
              },
            },
          });
          if (locked.feedbackQuestionnaireSlug) {
            await tx.questionnaire.deleteMany({
              where: { slug: locked.feedbackQuestionnaireSlug },
            });
          }
          return rowWithFeedback;
        }
        if (locked.feedbackQuestionnaireSlug) {
          const feedback = await tx.questionnaire.findUnique({
            where: { slug: locked.feedbackQuestionnaireSlug },
            select: { publishedAt: true },
          });
          if (feedback) {
            await tx.questionnaire.update({
              where: { slug: locked.feedbackQuestionnaireSlug },
              data: {
                title:
                  req.body.title === undefined
                    ? undefined
                    : `${refreshed.title} 问题反馈`,
                status:
                  req.body.status === undefined
                    ? undefined
                    : gradeFeedbackStatus(refreshed.status),
                publishedAt:
                  req.body.status === "open" && !feedback.publishedAt
                    ? now
                    : undefined,
                closedAt:
                  req.body.status === "closed"
                    ? now
                    : req.body.status === "open"
                      ? null
                      : undefined,
              },
            });
          }
        }
        return refreshed;
      });
      ok(res, normalizeGradeCheckTable(row));
    } catch (error) {
      next(error);
    }
  },
);

toolGradesRouter.delete("/grade-checks/:id", authRequired, async (req, res, next) => {
  try {
    const id = positiveRouteId(req.params.id);
    const current = await prisma.gradeCheckTable.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("查询表不存在");
    if (!(await canManageGradeCheckTable(current, req.user))) {
      throw Errors.forbidden("没有该查询表的管理权限");
    }
    await prisma.$transaction(async (tx) => {
      await acquireGradeCheckLock(tx, id);
      const locked = await tx.gradeCheckTable.findUnique({ where: { id } });
      if (!locked) throw Errors.notFound("查询表不存在");
      if (
        !isSiteAdmin(req.user?.role)
        && locked.createdById !== req.user!.userId
      ) {
        throw Errors.forbidden("没有该查询表的管理权限");
      }
      if (locked.feedbackQuestionnaireSlug) {
        const feedback = await tx.questionnaire.findUnique({
          where: { slug: locked.feedbackQuestionnaireSlug },
          select: { id: true },
        });
        if (feedback) await acquireQuestionnaireLock(tx, feedback.id);
      }
      await tx.gradeCheckTable.delete({ where: { id } });
      if (locked.feedbackQuestionnaireSlug) {
        await tx.questionnaire.deleteMany({
          where: { slug: locked.feedbackQuestionnaireSlug },
        });
      }
    });
    ok(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

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
