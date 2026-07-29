import { config } from "../config";
import {
  isLocalOrPrivateHost,
  joinPublicUrl,
} from "../utils/officePreview";
import { filestoreApiError } from "./filestoreApiError";
import { FILESTORE_MOUNT_PATH } from "./filestoreProxyRuntime";

export const FILESTORE_SITE_TITLE_DEFAULT = "靠浦文件收集";

export type FilestoreField = {
  id: string;
  key: string;
  label: string;
  required: boolean;
  pattern: string;
  placeholder: string;
};

type FilestoreSurveyFieldType =
  | "text"
  | "textarea"
  | "single"
  | "multiple"
  | "number"
  | "date"
  | "rating";

type FilestoreSurveyBranchRule = {
  action: "end" | "jump";
  targetId?: string;
};

export type FilestoreSurveyField = {
  id: string;
  label: string;
  type: FilestoreSurveyFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  branching?: Record<string, FilestoreSurveyBranchRule>;
};

export type FilestoreRules = {
  allowedTypes: string[];
  maxSizeMb: number;
  maxCount: number;
};

export function parseFilestoreJsonObject(
  raw: string | null | undefined,
): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        String(value ?? ""),
      ]),
    );
  } catch {
    return {};
  }
}

export function parseFilestoreJsonAnswers(
  raw: string | null | undefined,
): Record<string, string | string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = Array.isArray(value)
        ? value.map((item) => String(item ?? ""))
        : String(value ?? "");
    }
    return result;
  } catch {
    return {};
  }
}

export function normalizeFilestoreSiteTitle(value: unknown) {
  const title = String(value ?? "").trim();
  if (!title || /^filestore(?:\s|$)/i.test(title)) {
    return FILESTORE_SITE_TITLE_DEFAULT;
  }
  return title.slice(0, 80);
}

export function normalizeFilestoreSiteUrl(value: unknown) {
  return String(value ?? "").trim().replace(/\/+$/, "").slice(0, 240);
}

export function buildFilestorePublicUrl(
  base: string,
  mountedPath: string,
) {
  const normalizedBase = normalizeFilestoreSiteUrl(base);
  if (!normalizedBase) return "";
  let targetPath = mountedPath.startsWith("/")
    ? mountedPath
    : `/${mountedPath}`;
  try {
    const url = new URL(normalizedBase);
    if (
      config.nodeEnv === "production"
      && isLocalOrPrivateHost(url.host)
    ) {
      return "";
    }
    const basePath = url.pathname.replace(/\/+$/, "");
    if (
      basePath.endsWith(FILESTORE_MOUNT_PATH)
      && targetPath.startsWith(`${FILESTORE_MOUNT_PATH}/`)
    ) {
      targetPath = targetPath.slice(FILESTORE_MOUNT_PATH.length) || "/";
    }
  } catch {
    return "";
  }
  return joinPublicUrl(normalizedBase, targetPath);
}

function normalizeFieldKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function normalizeFilestoreFields(input: unknown): FilestoreField[] {
  if (!Array.isArray(input) || !input.length) {
    throw filestoreApiError(400, "至少需要一个表单字段");
  }
  const seen = new Set<string>();
  return input.map((item) => {
    const field = item && typeof item === "object"
      ? item as Record<string, unknown>
      : {};
    const key = normalizeFieldKey(field.key ?? field.id);
    const label = String(field.label ?? "").trim().slice(0, 80);
    if (!key || !label) {
      throw filestoreApiError(400, "字段 key 和名称不能为空");
    }
    if (seen.has(key)) {
      throw filestoreApiError(400, `字段 key 重复：${key}`);
    }
    const pattern = String(field.pattern ?? "").trim().slice(0, 200);
    if (pattern) {
      try {
        new RegExp(pattern);
      } catch {
        throw filestoreApiError(
          400,
          `字段“${label}”的正则规则不合法`,
        );
      }
    }
    seen.add(key);
    return {
      id: key,
      key,
      label,
      required: field.required !== false,
      pattern,
      placeholder: String(field.placeholder ?? "").trim().slice(0, 120),
    };
  });
}

export function storedFilestoreFields(fields: FilestoreField[]) {
  return fields.map((field) => ({
    id: field.key,
    label: field.label,
    required: field.required,
    pattern: field.pattern,
    placeholder: field.placeholder,
  }));
}

const filestoreSurveyFieldTypes = new Set<FilestoreSurveyFieldType>([
  "text",
  "textarea",
  "single",
  "multiple",
  "number",
  "date",
  "rating",
]);

function normalizeSurveyFieldId(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeSurveyOptions(value: unknown) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "").split(/\r?\n|,/);
  return [
    ...new Set(
      list
        .map((item) => String(item ?? "").trim().slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function normalizeOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeSurveyBranching(
  source: unknown,
  field: {
    id: string;
    label: string;
    type: FilestoreSurveyFieldType;
    options?: string[];
  },
  indexById: Map<string, number>,
) {
  if (
    !source
    || typeof source !== "object"
    || field.type !== "single"
  ) {
    return undefined;
  }
  const options = new Set(field.options ?? []);
  const currentIndex = indexById.get(field.id) ?? 0;
  const result: Record<string, FilestoreSurveyBranchRule> = {};
  for (
    const [option, rawRule]
    of Object.entries(source as Record<string, unknown>)
  ) {
    if (
      !options.has(option)
      || !rawRule
      || typeof rawRule !== "object"
    ) {
      continue;
    }
    const rule = rawRule as Record<string, unknown>;
    const action = String(rule.action || "").trim();
    if (action === "end") {
      result[option] = { action: "end" };
      continue;
    }
    const targetId = normalizeSurveyFieldId(rule.targetId);
    const targetIndex = indexById.get(targetId);
    if (
      action === "jump"
      && targetId
      && targetIndex !== undefined
      && targetIndex > currentIndex
    ) {
      result[option] = { action: "jump", targetId };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function normalizeFilestoreSurveyFields(
  input: unknown,
): FilestoreSurveyField[] {
  if (!Array.isArray(input)) return [];
  const drafts = input.slice(0, 30).map((item) => {
    const row = item && typeof item === "object"
      ? item as Record<string, unknown>
      : {};
    const id = normalizeSurveyFieldId(row.id);
    const label = String(row.label ?? "").trim().slice(0, 80);
    const type = String(row.type ?? "text") as FilestoreSurveyFieldType;
    if (!id || !label) {
      throw filestoreApiError(400, "问卷题目的 ID 和标题不能为空");
    }
    if (!filestoreSurveyFieldTypes.has(type)) {
      throw filestoreApiError(400, `问卷题目“${label}”类型不支持`);
    }
    const field: FilestoreSurveyField = {
      id,
      label,
      type,
      required: row.required === true,
      placeholder:
        String(row.placeholder ?? "").trim().slice(0, 120) || undefined,
      description:
        String(row.description ?? "").trim().slice(0, 300) || undefined,
      min: normalizeOptionalNumber(row.min),
      max: normalizeOptionalNumber(row.max),
      step: normalizeOptionalNumber(row.step),
      maxLength: Math.min(
        2000,
        Math.max(
          1,
          Math.round(
            Number(row.maxLength || (type === "textarea" ? 2000 : 300)),
          ),
        ),
      ),
    };
    if (type === "single" || type === "multiple") {
      field.options = normalizeSurveyOptions(row.options);
      if (field.options.length < 2) {
        throw filestoreApiError(
          400,
          `选项题“${label}”至少需要 2 个选项`,
        );
      }
    } else {
      delete field.options;
    }
    if (type === "rating") {
      const min = Math.max(0, Math.round(field.min ?? 1));
      const max = Math.min(10, Math.round(field.max ?? 5));
      if (min >= max) {
        throw filestoreApiError(
          400,
          `评分题“${label}”的最高分需要大于最低分`,
        );
      }
      field.min = min;
      field.max = max;
      delete field.step;
    } else if (type === "number") {
      if (
        field.min !== undefined
        && field.max !== undefined
        && field.min > field.max
      ) {
        throw filestoreApiError(
          400,
          `数字题“${label}”的最小值不能大于最大值`,
        );
      }
      field.step = field.step && field.step > 0 ? field.step : 1;
    } else {
      delete field.min;
      delete field.max;
      delete field.step;
    }
    return { field, rawBranching: row.branching };
  });

  const ids = new Set<string>();
  for (const { field } of drafts) {
    if (ids.has(field.id)) {
      throw filestoreApiError(400, `问卷题目 ID 重复：${field.id}`);
    }
    ids.add(field.id);
  }
  const indexById = new Map(
    drafts.map(({ field }, index) => [field.id, index]),
  );
  return drafts.map(({ field, rawBranching }) => {
    const branching = normalizeSurveyBranching(
      rawBranching,
      field,
      indexById,
    );
    if (branching) field.branching = branching;
    return field;
  });
}

export function storedFilestoreSurveyFields(
  fields: FilestoreSurveyField[],
) {
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required === true,
    placeholder: field.placeholder,
    description: field.description,
    options: field.options,
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
    branching: field.branching,
  }));
}

export function parseStoredFilestoreSurveyFields(
  raw: string | null | undefined,
): FilestoreSurveyField[] {
  try {
    return normalizeFilestoreSurveyFields(JSON.parse(raw || "[]"));
  } catch {
    return [];
  }
}

export function parseStoredFilestoreFields(
  raw: string | null | undefined,
): FilestoreField[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return normalizeFilestoreFields(
      Array.isArray(parsed)
        ? parsed.map((item) => ({
            ...item,
            key: item?.key ?? item?.id,
          }))
        : [],
    );
  } catch {
    return [];
  }
}

function normalizeAllowedTypes(value: unknown) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return [
    ...new Set(
      list
        .map((item) =>
          String(item ?? "").trim().toLowerCase().replace(/^\.+/, "")
        )
        .filter((item) => /^[a-z0-9]+$/.test(item))
        .slice(0, 30),
    ),
  ];
}

export function normalizeFilestoreRules(input: unknown): FilestoreRules {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const maxSizeMb = Number(source.maxSizeMb || 20);
  const maxCount = Number(source.maxCount || 1);
  if (
    !Number.isFinite(maxSizeMb)
    || maxSizeMb <= 0
    || maxSizeMb > 100
  ) {
    throw filestoreApiError(
      400,
      "单文件大小必须在 0 到 100 MB 之间",
    );
  }
  if (
    !Number.isInteger(maxCount)
    || maxCount <= 0
    || maxCount > 20
  ) {
    throw filestoreApiError(400, "文件数量必须在 1 到 20 个之间");
  }
  return {
    allowedTypes: normalizeAllowedTypes(source.allowedTypes),
    maxSizeMb,
    maxCount,
  };
}

export function parseStoredFilestoreRules(
  raw: string | null | undefined,
): FilestoreRules {
  try {
    return normalizeFilestoreRules(JSON.parse(raw || "{}"));
  } catch {
    return { allowedTypes: [], maxSizeMb: 20, maxCount: 1 };
  }
}

function normalizeDeadline(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw filestoreApiError(400, "截止时间不合法");
  }
  return date;
}

export function filestoreIsoDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function normalizeFilestoreStatus(value: unknown) {
  const status = String(value ?? "open").trim();
  if (
    status === "open"
    || status === "draft"
    || status === "closed"
  ) {
    return status;
  }
  return "closed";
}

export function normalizeFilestoreTaskPayload(
  input: Record<string, unknown>,
) {
  const title = String(input.title ?? "").trim().slice(0, 120);
  if (!title) throw filestoreApiError(400, "任务标题不能为空");
  const fields = normalizeFilestoreFields(input.fields);
  const surveyFields = normalizeFilestoreSurveyFields(input.surveyFields);
  const fileRules = normalizeFilestoreRules(input.fileRules);
  return {
    title,
    description: String(input.description ?? "").trim().slice(0, 1000),
    deadline: normalizeDeadline(input.deadline),
    status: normalizeFilestoreStatus(input.status),
    fields,
    surveyFields,
    fileRules,
    renameTemplate:
      String(input.renameTemplate ?? "{name}-{student_id}")
        .trim()
        .slice(0, 120) || "{name}-{student_id}",
    folderTemplate:
      String(input.folderTemplate ?? "{name}-{student_id}")
        .trim()
        .slice(0, 120) || "{name}-{student_id}",
    expectedEntries:
      String(input.expectedEntries ?? "").trim().slice(0, 20000),
  };
}

export function normalizeFilestoreTemplatePayload(input: unknown) {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const name = String(source.name ?? "").trim().slice(0, 60);
  if (!name) throw filestoreApiError(400, "模板名称不能为空");
  const fields = normalizeFilestoreFields(source.fields);
  const surveyFields = normalizeFilestoreSurveyFields(source.surveyFields);
  const fileRules = normalizeFilestoreRules(source.fileRules);
  return {
    id: source.id,
    name,
    description:
      String(source.description ?? "").trim().slice(0, 1000),
    fields,
    surveyFields,
    fileRules,
    renameTemplate:
      String(source.renameTemplate ?? "{name}-{student_id}")
        .trim()
        .slice(0, 120) || "{name}-{student_id}",
    folderTemplate:
      String(source.folderTemplate ?? "{name}-{student_id}")
        .trim()
        .slice(0, 120) || "{name}-{student_id}",
    expectedEntries:
      String(source.expectedEntries ?? "").trim().slice(0, 20000),
  };
}
