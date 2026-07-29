import { prisma } from "../prisma";
import { SERVICE_TOOL_META, type ServiceToolCode } from "./serviceTools";
import { acquireQuestionnaireLock } from "./questionnaireLockService";

export type QuestionnaireFieldType = "text" | "textarea" | "single" | "multiple" | "number" | "date" | "rating";
export type QuestionnaireBranchAction = "end" | "jump";

export interface QuestionnaireBranchRule {
  action: QuestionnaireBranchAction;
  targetId?: string;
}

export interface QuestionnaireField {
  id: string;
  label: string;
  type: QuestionnaireFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  branching?: Record<string, QuestionnaireBranchRule>;
}

export function parseFields(raw: string | null | undefined): QuestionnaireField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseAnswers(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeQuestionnaire(row: any, options: { includeFields?: boolean; includeStats?: boolean } = {}) {
  const result: Record<string, unknown> = {
    id: row.id,
    toolCode: row.toolCode,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    allowAnonymous: row.allowAnonymous,
    oneResponsePerUser: row.oneResponsePerUser,
    isSystem: row.isSystem,
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
  if (options.includeFields) result.fields = parseFields(row.fields);
  if (options.includeStats) result.responseCount = row._count?.responses ?? row.responseCount ?? 0;
  return result;
}

export function normalizeResponse(row: any) {
  return {
    id: row.id,
    questionnaireId: row.questionnaireId,
    answers: parseAnswers(row.answers),
    respondent: row.respondent ? {
      id: row.respondent.id,
      username: row.respondent.username,
      nickname: row.respondent.nickname,
      avatar: row.respondent.avatar,
      role: row.respondent.role,
    } : null,
    createdAt: row.createdAt,
  };
}

let ensureSystemQuestionnairesPromise: Promise<void> | null = null;

export function ensureSystemQuestionnaires() {
  if (!ensureSystemQuestionnairesPromise) {
    ensureSystemQuestionnairesPromise = initializeSystemQuestionnaires()
      .catch((error) => {
        ensureSystemQuestionnairesPromise = null;
        throw error;
      });
  }
  return ensureSystemQuestionnairesPromise;
}

async function initializeSystemQuestionnaires() {
  await ensureSystemQuestionnaire("feedback", {
    slug: "system-feedback",
    title: "需求反馈",
    description: "告诉我们你希望新增的小工具、遇到的问题，或者在线问卷需要支持的场景。",
    fields: [
      {
        id: "category",
        label: "类型",
        type: "single",
        required: true,
        options: ["工具建议", "问题反馈", "问卷需求", "其他"],
      },
      {
        id: "content",
        label: "内容",
        type: "textarea",
        required: true,
        placeholder: "想要什么小工具、希望怎么用，或者遇到了什么问题...",
      },
      {
        id: "contact",
        label: "联系方式",
        type: "text",
        required: false,
        placeholder: "选填，例如 QQ / 邮箱 / 站内昵称",
      },
    ],
  });
}

async function ensureSystemQuestionnaire(toolCode: ServiceToolCode, input: {
  slug: string;
  title: string;
  description: string;
  fields: QuestionnaireField[];
}) {
  const fields = JSON.stringify(input.fields);
  const current = await prisma.questionnaire.findUnique({
    where: { slug: input.slug },
  });
  if (!current) {
    try {
      await prisma.questionnaire.create({
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          toolCode,
          status: "open",
          visibility: "public",
          allowAnonymous: true,
          oneResponsePerUser: false,
          isSystem: true,
          fields,
          publishedAt: new Date(),
        },
      });
      return;
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") {
        await ensureSystemQuestionnaire(toolCode, input);
        return;
      }
      throw error;
    }
  }

  if (systemQuestionnaireMatches(current, toolCode, input, fields)) return;

  await prisma.$transaction(async (tx) => {
    await acquireQuestionnaireLock(tx, current.id);
    const locked = await tx.questionnaire.findUnique({ where: { id: current.id } });
    if (!locked || systemQuestionnaireMatches(locked, toolCode, input, fields)) return;
    await tx.questionnaire.update({
      where: { id: locked.id },
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description,
        toolCode,
        status: "open",
        visibility: "public",
        allowAnonymous: true,
        oneResponsePerUser: false,
        isSystem: true,
        fields,
        publishedAt: locked.publishedAt ?? new Date(),
        closedAt: null,
      },
    });
  });
}

function systemQuestionnaireMatches(
  current: {
    title: string;
    description: string | null;
    toolCode: string;
    status: string;
    visibility: string;
    allowAnonymous: boolean;
    oneResponsePerUser: boolean;
    isSystem: boolean;
    fields: string;
    publishedAt: Date | null;
    closedAt: Date | null;
  },
  toolCode: ServiceToolCode,
  input: { title: string; description: string },
  fields: string,
) {
  return current.title === input.title
    && current.description === input.description
    && current.toolCode === toolCode
    && current.status === "open"
    && current.visibility === "public"
    && current.allowAnonymous
    && !current.oneResponsePerUser
    && current.isSystem
    && current.fields === fields
    && Boolean(current.publishedAt)
    && current.closedAt === null;
}

export function toolName(toolCode: string) {
  return SERVICE_TOOL_META[toolCode as ServiceToolCode]?.name ?? toolCode;
}
