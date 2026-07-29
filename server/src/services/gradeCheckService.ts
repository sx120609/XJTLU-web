import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { acquireGradeCheckLock } from "./gradeCheckLockService";
import type { QuestionnaireField } from "./questionnaires";
import {
  hasToolContentManagePermission,
  isSiteAdmin,
} from "./serviceTools";
import { questionnaireSlugBase } from "./toolSlugService";

export function parseGradeColumns(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseGradePayload(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]),
    );
  } catch {
    return {};
  }
}

export function normalizeGradeCheckTable(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    studentIdColumn: row.studentIdColumn,
    columns: parseGradeColumns(row.columns),
    rowCount: row.rowCount,
    feedbackQuestionnaireSlug: row.feedbackQuestionnaireSlug,
    publishedAt: row.publishedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ? {
      id: row.createdBy.id,
      nickname: row.createdBy.nickname,
      username: row.createdBy.username,
      role: row.createdBy.role,
    } : null,
  };
}

export function normalizeGradeCheckInput(input: {
  studentIdColumn: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}) {
  const studentIdColumn = input.studentIdColumn.trim() || "学号";
  const columns = input.columns.map((item) => item.trim()).filter(Boolean);
  if (!columns.includes(studentIdColumn)) {
    throw Errors.badRequest(`Excel 必须包含“${studentIdColumn}”字段`);
  }
  if (new Set(columns).size !== columns.length) {
    throw Errors.badRequest("Excel 表头不能重复");
  }

  const seen = new Set<string>();
  const rows: Array<{ studentId: string; payload: Record<string, string> }> = [];
  input.rows.forEach((raw, index) => {
    const payload: Record<string, string> = {};
    for (const column of columns) payload[column] = formatGradeCell(raw[column]);
    if (!columns.some((column) => payload[column])) return;

    const studentId = normalizeStudentId(payload[studentIdColumn]);
    if (!studentId) throw Errors.badRequest(`第 ${index + 2} 行缺少学号`);
    if (seen.has(studentId)) throw Errors.badRequest(`学号重复：${studentId}`);
    seen.add(studentId);
    payload[studentIdColumn] = studentId;
    rows.push({ studentId, payload });
  });

  if (!rows.length) throw Errors.badRequest("Excel 至少需要 1 行有效数据");
  return { studentIdColumn, columns, rows };
}

function formatGradeCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value).trim();
}

export function normalizeStudentId(
  value: string | number | boolean | null | undefined,
) {
  return formatGradeCell(value).replace(/\s+/g, "");
}

export function buildGradeCheckFeedbackFields(
  columns: string[],
  studentIdColumn: string,
): QuestionnaireField[] {
  const options = columns.filter((column) => column !== studentIdColumn).slice(0, 20);
  return [
    {
      id: "student_id",
      label: "学号",
      type: "text",
      required: true,
      placeholder: "请填写你的学号，便于发起者核对",
      maxLength: 40,
    },
    {
      id: "problem_fields",
      label: "哪些项目存在问题",
      type: "multiple",
      required: true,
      options: options.length >= 2 ? options : ["成绩信息", "个人信息", "其他"],
    },
    {
      id: "problem_type",
      label: "问题类型",
      type: "single",
      required: true,
      options: ["信息有误", "成绩有疑问", "缺少记录", "无法确认", "其他"],
    },
    {
      id: "description",
      label: "问题说明",
      type: "textarea",
      required: true,
      placeholder: "请说明你认为有问题的项目、当前显示值和你认为正确的信息。",
      maxLength: 2000,
    },
    {
      id: "contact",
      label: "联系方式",
      type: "text",
      required: false,
      placeholder: "选填，便于发起者进一步联系",
      maxLength: 120,
    },
  ];
}

export function gradeFeedbackStatus(status: string) {
  if (status === "open") return "open";
  if (status === "closed") return "closed";
  return "draft";
}

export async function ensureGradeCheckFeedbackQuestionnaire(table: {
  id: number;
  title: string;
  status: string;
  columns: string;
  studentIdColumn: string;
  createdById: number | null;
  feedbackQuestionnaireSlug: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await acquireGradeCheckLock(tx, table.id);
    const current = await tx.gradeCheckTable.findUnique({ where: { id: table.id } });
    if (!current) throw Errors.notFound("查询表不存在");
    if (current.feedbackQuestionnaireSlug) {
      const exists = await tx.questionnaire.findUnique({
        where: { slug: current.feedbackQuestionnaireSlug },
        select: { id: true },
      });
      if (exists) return current.feedbackQuestionnaireSlug;
    }

    const now = new Date();
    const base = questionnaireSlugBase(`${current.title} 问题反馈`);
    const slug = `${base}-${current.id}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await tx.questionnaire.create({
      data: {
        toolCode: "questionnaire",
        slug,
        title: `${current.title} 问题反馈`,
        description: "如核对项目存在问题，请提交说明。",
        status: gradeFeedbackStatus(current.status),
        visibility: "login",
        allowAnonymous: false,
        oneResponsePerUser: false,
        isSystem: false,
        fields: JSON.stringify(
          buildGradeCheckFeedbackFields(
            parseGradeColumns(current.columns),
            current.studentIdColumn,
          ),
        ),
        createdById: current.createdById,
        publishedAt: current.status === "open" ? now : null,
        closedAt: current.status === "closed" ? now : null,
      },
    });
    await tx.gradeCheckTable.update({
      where: { id: current.id },
      data: { feedbackQuestionnaireSlug: slug },
    });
    return slug;
  });
}

export async function canManageGradeCheckTable(
  row: { createdById: number | null },
  user: Express.Request["user"],
) {
  if (!user?.userId) return false;
  if (isSiteAdmin(user.role)) return true;
  return row.createdById === user.userId
    && await hasToolContentManagePermission("grade_check", user);
}

export async function canManageGradeFeedbackQuestionnaire(
  slug: string,
  user: Express.Request["user"],
) {
  const table = await prisma.gradeCheckTable.findFirst({
    where: { feedbackQuestionnaireSlug: slug },
    select: { createdById: true },
  });
  return table ? canManageGradeCheckTable(table, user) : false;
}
