import express, { type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import QRCode from "qrcode";
import { prisma } from "../prisma";
import { getSiteFilingNumber, getSiteOrigin } from "./siteSettings";
import { requestAiJson } from "./topicAiReview";
import {
  createRemoteMediaUploadSession,
  deleteMediaAsset,
  ensureMediaLocalPathFromUploadUrl,
  saveMediaAsset,
  shouldUseRemoteMediaStorageForRelativePath,
} from "./mediaStorage";
import {
  getOneDriveChinaItemMetadata,
  moveOneDriveChinaItem,
  resolveOneDriveChinaDirectDownloadUrl,
  resolveOneDriveChinaPreviewUrl,
} from "./oneDriveChina";
import { getMediaStorageRuntimeConfig } from "./storageConfig";
import { repairFileCollectTaskFilenames } from "./fileCollectFilenameRepair";
import {
  acquireFileCollectSubmissionLock,
  acquireFileCollectTaskLock,
} from "./fileCollectLockService";
import {
  assertNoActiveFileCollectUploads,
  deleteUploadingFileCollectSubmission,
  refreshFileCollectTaskCounters,
  removeStaleFileCollectUploadsForIdentity,
} from "./fileCollectSubmissionService";
import {
  signFileCollectCompletionToken,
  verifyFileCollectCompletionToken,
} from "./fileCollectCompletionToken";
import {
  ensureFilestoreStarted,
  FILESTORE_MOUNT_PATH as MOUNT_PATH,
  filestoreUpstreamPath as upstreamPath,
  proxyToFilestore,
} from "./filestoreProxyRuntime";
import {
  assertFilestoreAccess,
  type FilestoreAccessUser,
} from "./filestoreAccessService";
import {
  buildFilestorePublicUrl,
  FILESTORE_SITE_TITLE_DEFAULT,
  filestoreIsoDate as isoDate,
  normalizeFilestoreSiteTitle as normalizeSiteTitle,
  normalizeFilestoreSiteUrl as normalizeSiteUrl,
  normalizeFilestoreStatus,
  normalizeFilestoreTaskPayload,
  normalizeFilestoreTemplatePayload as normalizeTemplatePayload,
  parseFilestoreJsonAnswers as parseJsonAnswers,
  parseFilestoreJsonObject as parseJsonObject,
  parseStoredFilestoreFields as parseStoredFields,
  parseStoredFilestoreRules as parseStoredRules,
  parseStoredFilestoreSurveyFields as parseStoredSurveyFields,
  storedFilestoreFields as storedFields,
  storedFilestoreSurveyFields as storedSurveyFields,
  type FilestoreField,
  type FilestoreRules,
  type FilestoreSurveyField,
} from "./filestoreContracts";
import {
  filestoreApiError,
  sendFilestoreApiError,
} from "./filestoreApiError";
export { normalizeFilestoreStatus } from "./filestoreContracts";
import { notifyFileCollectSubmissionForQqBot } from "./toolQqReminders";
import {
  buildOfficeViewerUrl,
  canUseOfficeWebViewer,
  isOfficePreviewFile,
  joinPublicUrl,
  normalizePreviewPublicOrigin,
  officeWebViewerLimitMessage,
  requestPublicOrigin,
  signFileCollectPreviewToken,
  verifyFileCollectPreviewToken,
} from "../utils/officePreview";
import { normalizeMulterOriginalNames, normalizeUploadOriginalName } from "../utils/uploadFilename";
import { querySize } from "../utils/query";

const FILESTORE_SITE_TITLE_KEY = "filestore.siteTitle";
const FILESTORE_SITE_URL_KEY = "filestore.siteUrl";
const FILESTORE_TEMPLATE_VISIBILITY = "filestore-global";
const fileCollectTmpDir = path.resolve(process.cwd(), "runtime", "file-collect-tmp");

const filestoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdir(fileCollectTmpDir, { recursive: true })
        .then(() => cb(null, fileCollectTmpDir))
        .catch((error) => cb(error, fileCollectTmpDir));
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(normalizeUploadOriginalName(file.originalname))}`),
  }),
  limits: {
    files: 20,
    fileSize: 100 * 1024 * 1024,
    fieldSize: 1024 * 1024,
  },
});

function queryStringValue(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

async function parseFilestoreJsonBody(req: Request, res: Response) {
  await new Promise<void>((resolve, reject) => {
    express.json({ limit: "10mb" })(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  return (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
}

async function parseFilestoreUpload(req: Request, res: Response) {
  return new Promise<Express.Multer.File[]>((resolve, reject) => {
    filestoreUpload.array("files", 20)(req, res, (err) => {
      if (err) reject(err);
      else resolve(normalizeMulterOriginalNames((req.files as Express.Multer.File[] | undefined) ?? []));
    });
  });
}

function userIsSuperAdmin(user: FilestoreAccessUser | null | undefined) {
  return user?.role === "admin";
}

function userCanManageGlobalFilestore(user: FilestoreAccessUser | null | undefined) {
  return Boolean(user?.isToolManager);
}

function canAccessFilestoreTask(user: FilestoreAccessUser | null | undefined, row: { createdById: number | null }) {
  if (!user?.userId) return false;
  if (userIsSuperAdmin(user)) return true;
  return row.createdById === user.userId;
}

function filestoreCreatedBy(row: any) {
  if (!row.createdBy) return null;
  return {
    userId: row.createdBy.id,
    username: row.createdBy.username,
    displayName: row.createdBy.nickname || row.createdBy.username,
    role: row.createdBy.role,
  };
}

function normalizeFilestoreSubmission(row: any) {
  return {
    id: row.id,
    data: parseJsonObject(row.data),
    answers: parseJsonAnswers(row.answers),
    ip: row.ip || "",
    status: row.status || "submitted",
    createdAt: isoDate(row.createdAt),
    files: (row.files ?? []).map((file: any) => ({
      id: file.id,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: isoDate(file.createdAt),
    })),
  };
}

function normalizeSubmissionIdentityValue(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "").slice(0, 300);
}

function submissionIdentity(data: Record<string, string>, fields: FilestoreField[] = []) {
  const preferred = ["student_id", "student_no", "exam_id", "id", "number", "no", "name", "group", "team", "姓名", "学号", "组别"];
  const preferredKey = preferred.find((key) => normalizeSubmissionIdentityValue(data[key]));
  if (preferredKey) return normalizeSubmissionIdentityValue(data[preferredKey]);

  const requiredField = fields.find((field) => normalizeSubmissionIdentityValue(data[field.key] ?? data[field.id]));
  if (requiredField) return normalizeSubmissionIdentityValue(data[requiredField.key] ?? data[requiredField.id]);

  const firstValue = Object.values(data).find((value) => normalizeSubmissionIdentityValue(value));
  return normalizeSubmissionIdentityValue(firstValue);
}

function submissionIdentityLabel(data: Record<string, string>, fields: FilestoreField[] = []) {
  const identity = submissionIdentity(data, fields);
  if (!identity) return "身份信息";
  const matched = fields.find((field) => normalizeSubmissionIdentityValue(data[field.key] ?? data[field.id]) === identity);
  return matched?.label || "身份信息";
}

function parseOverwriteFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(text);
}

async function findExistingSubmittedFilestoreSubmission(taskId: number, identity: string) {
  if (!identity) return null;
  return prisma.fileCollectSubmission.findFirst({
    where: { taskId, identity, status: "submitted" },
    orderBy: { createdAt: "desc" },
    include: { files: { orderBy: { id: "asc" } } },
  });
}

function duplicateSubmissionPayload(existing: NonNullable<Awaited<ReturnType<typeof findExistingSubmittedFilestoreSubmission>>>, identity: string, identityLabel: string) {
  return {
    error: "该身份已提交过，请确认是否覆盖",
    code: "DUPLICATE_SUBMISSION",
    exists: true,
    identity,
    identityLabel,
    submission: {
      id: existing.id,
      createdAt: isoDate(existing.createdAt),
      fileCount: existing.files.length,
      files: existing.files.slice(0, 5).map((file) => file.storedName),
    },
  };
}

async function assertCanCreateOrOverwriteSubmission(taskId: number, identity: string, identityLabel: string, overwrite: boolean) {
  const existing = await findExistingSubmittedFilestoreSubmission(taskId, identity);
  assertCanCreateOrOverwriteExisting(existing, identity, identityLabel, overwrite);
  return existing;
}

function assertCanCreateOrOverwriteExisting(
  existing: Awaited<ReturnType<typeof findExistingSubmittedFilestoreSubmission>>,
  identity: string,
  identityLabel: string,
  overwrite: boolean,
) {
  if (existing && !overwrite) {
    throw filestoreApiError(409, "该身份已提交过，请确认是否覆盖", duplicateSubmissionPayload(existing, identity, identityLabel));
  }
}

function assertFilestoreTaskAcceptsSubmission(task: { status: string; deadline: Date | null }) {
  if (normalizeFilestoreStatus(task.status) !== "open") throw filestoreApiError(400, "任务未开放提交");
  if (task.deadline && Date.now() > task.deadline.getTime()) throw filestoreApiError(400, "已超过截止时间");
}

function buildFilestoreStats(task: { expectedEntries: string }, submissions: Array<{ id: number; data: Record<string, string>; createdAt: string }>) {
  const expected = task.expectedEntries.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const expectedKeys = new Set(expected);
  const matched = new Set<string>();
  const unexpected: Array<{ id: number; name: string; identity: string; createdAt: string }> = [];
  for (const item of submissions) {
    const identity = submissionIdentity(item.data);
    if (expectedKeys.size && expectedKeys.has(identity)) {
      matched.add(identity);
    } else if (expectedKeys.size) {
      unexpected.push({
        id: item.id,
        name: item.data.name || "",
        identity,
        createdAt: item.createdAt,
      });
    }
  }
  return {
    submitted: submissions.length,
    inListSubmitted: expected.length ? matched.size : submissions.length,
    expected: expected.length,
    missing: expected.filter((item) => !matched.has(item)),
    unexpected,
  };
}

function normalizeFilestoreTask(row: any, options: { includeCreator?: boolean; includeSubmissions?: boolean } = {}) {
  const fields = parseStoredFields(row.fields);
  const submissions = options.includeSubmissions
    ? (row.submissions ?? []).map(normalizeFilestoreSubmission)
    : undefined;
  const task: Record<string, unknown> = {
    id: row.id,
    slug: row.slug,
    token: row.slug,
    title: row.title,
    description: row.description || "",
    deadline: isoDate(row.deadline),
    fields,
    surveyFields: parseStoredSurveyFields(row.surveyFields),
    fileRules: parseStoredRules(row.fileRules),
    renameTemplate: row.renameTemplate || "{name}-{student_id}",
    folderTemplate: row.folderTemplate || "{name}-{student_id}",
    expectedEntries: row.expectedEntries || "",
    status: normalizeFilestoreStatus(row.status),
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
    submitUrl: `${MOUNT_PATH}/submit/${row.slug}`,
  };
  if (options.includeCreator) task.createdBy = filestoreCreatedBy(row);
  if (submissions) {
    task.submissions = submissions;
    task.stats = buildFilestoreStats({ expectedEntries: String(task.expectedEntries || "") }, submissions);
  }
  return task;
}

function normalizeFilestoreTemplate(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    fields: parseStoredFields(row.fields),
    surveyFields: parseStoredSurveyFields(row.surveyFields),
    fileRules: parseStoredRules(row.fileRules),
    renameTemplate: row.renameTemplate || "{name}-{student_id}",
    folderTemplate: row.folderTemplate || "{name}-{student_id}",
    expectedEntries: row.expectedEntries || "",
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

async function getFilestoreSiteSetting(key: string, fallback = "") {
  const row = await prisma.siteSetting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? fallback;
}

async function setFilestoreSiteSetting(key: string, value: string) {
  await prisma.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function listFilestoreTemplates() {
  const rows = await prisma.fileCollectTemplate.findMany({
    where: { visibility: FILESTORE_TEMPLATE_VISIBILITY },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(normalizeFilestoreTemplate);
}

async function filestoreSettings() {
  const [siteUrl, siteTitle, taskTemplates] = await Promise.all([
    getFilestoreSiteSetting(FILESTORE_SITE_URL_KEY, ""),
    getFilestoreSiteSetting(FILESTORE_SITE_TITLE_KEY, FILESTORE_SITE_TITLE_DEFAULT),
    listFilestoreTemplates(),
  ]);
  return {
    siteUrl,
    siteTitle: normalizeSiteTitle(siteTitle),
    taskTemplates,
  };
}

async function saveFilestoreTemplates(input: unknown[]) {
  const templates = input.map(normalizeTemplatePayload);
  const numericIds = templates
    .map((template) => Number(template.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  await prisma.$transaction(async (tx) => {
    await tx.fileCollectTemplate.deleteMany({
      where: {
        visibility: FILESTORE_TEMPLATE_VISIBILITY,
        ...(numericIds.length ? { id: { notIn: numericIds } } : {}),
      },
    });
    for (const template of templates) {
      const id = Number(template.id);
      const data = {
        name: template.name,
        description: template.description || null,
        visibility: FILESTORE_TEMPLATE_VISIBILITY,
        fields: JSON.stringify(storedFields(template.fields)),
        surveyFields: JSON.stringify(storedSurveyFields(template.surveyFields)),
        fileRules: JSON.stringify(template.fileRules),
        renameTemplate: template.renameTemplate,
        folderTemplate: template.folderTemplate,
        expectedEntries: template.expectedEntries,
        createdById: null,
      };
      if (Number.isInteger(id) && id > 0) {
        const updated = await tx.fileCollectTemplate.updateMany({
          where: { id, visibility: FILESTORE_TEMPLATE_VISIBILITY },
          data,
        });
        if (updated.count) continue;
      }
      await tx.fileCollectTemplate.create({ data });
    }
  });
}

async function nextFilestoreToken() {
  for (let i = 0; i < 20; i += 1) {
    const token = `fs-${Date.now().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const exists = await prisma.fileCollectTask.findUnique({ where: { slug: token }, select: { id: true } });
    if (!exists) return token;
  }
  return `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function taskInclude(includeSubmissions = false) {
  return {
    createdBy: { select: { id: true, username: true, nickname: true, role: true } },
    ...(includeSubmissions ? {
      submissions: {
        where: { status: "submitted" as const },
        orderBy: { createdAt: "desc" as const },
        include: { files: { orderBy: { id: "asc" as const } } },
      },
    } : {}),
  };
}

async function getFilestoreTaskForActor(id: number, user: FilestoreAccessUser | null, includeSubmissions = true) {
  const row = await prisma.fileCollectTask.findUnique({
    where: { id },
    include: taskInclude(includeSubmissions),
  });
  if (!row || !canAccessFilestoreTask(user, row)) return null;
  return row;
}

function safeStoredFilename(value: string) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160);
  return cleaned || "file";
}

function renderTemplateBase(template: string, data: Record<string, string>, originalName = "", index = 1, total = 1) {
  const ext = path.extname(originalName || "");
  const stem = path.basename(originalName || "file", ext);
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeStoredFilename(value)])),
    original: safeStoredFilename(stem),
    index: total > 1 ? String(index) : "",
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return safeStoredFilename(rendered).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}

function renderStoredName(template: string, data: Record<string, string>, originalName: string, index: number, total: number) {
  const ext = path.extname(originalName || "").toLowerCase();
  const base = renderTemplateBase(template, data, originalName, index, total);
  const withIndex = total > 1 && !template.includes("{index}") ? `${base}-${index}` : base;
  return `${withIndex}${ext}`;
}

async function unlinkFileCollectPath(relative: string) {
  await deleteMediaAsset(relative).catch(() => null);
}

function normalizeSubmissionData(fields: FilestoreField[], input: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = String(input[field.key] ?? input[field.id] ?? "").trim();
    if (field.required && !value) throw filestoreApiError(400, `${field.label}不能为空`);
    if (value && field.pattern && !(new RegExp(field.pattern).test(value))) {
      throw filestoreApiError(400, `${field.label}格式不正确`);
    }
    result[field.key] = value.slice(0, 300);
  }
  return result;
}

function normalizeSurveyAnswerInput(value: unknown): Record<string, string | string[]> {
  if (typeof value === "string") return parseJsonAnswers(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result: Record<string, string | string[]> = {};
    for (const [key, raw] of Object.entries(value)) {
      result[key] = Array.isArray(raw) ? raw.map((item) => String(item ?? "")) : String(raw ?? "");
    }
    return result;
  }
  return {};
}

function activeSurveyFields(fields: FilestoreSurveyField[], input: Record<string, string | string[]>) {
  const result: FilestoreSurveyField[] = [];
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

function normalizeSurveyAnswers(fields: FilestoreSurveyField[], input: Record<string, string | string[]>) {
  const result: Record<string, string | string[]> = {};
  for (const field of activeSurveyFields(fields, input)) {
    const raw = input[field.id];
    if (field.type === "multiple") {
      const values = Array.isArray(raw) ? raw.map(String).map((item) => item.trim()).filter(Boolean) : [];
      if (field.required && !values.length) throw filestoreApiError(400, `请填写：${field.label}`);
      const allowed = new Set(field.options ?? []);
      const invalid = values.find((value) => !allowed.has(value));
      if (invalid) throw filestoreApiError(400, `“${field.label}”包含无效选项`);
      result[field.id] = values;
      continue;
    }
    const value = Array.isArray(raw) ? "" : String(raw ?? "").trim();
    if (field.required && !value) throw filestoreApiError(400, `请填写：${field.label}`);
    if (field.type === "single" && value) {
      const allowed = new Set(field.options ?? []);
      if (!allowed.has(value)) throw filestoreApiError(400, `“${field.label}”包含无效选项`);
    }
    if (field.type === "number" && value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw filestoreApiError(400, `“${field.label}”需要填写数字`);
      if (field.min !== undefined && numeric < field.min) throw filestoreApiError(400, `“${field.label}”不能小于 ${field.min}`);
      if (field.max !== undefined && numeric > field.max) throw filestoreApiError(400, `“${field.label}”不能大于 ${field.max}`);
    }
    if (field.type === "rating" && value) {
      const numeric = Number(value);
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
        throw filestoreApiError(400, `“${field.label}”评分不合法`);
      }
    }
    if (field.type === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw filestoreApiError(400, `“${field.label}”日期格式不合法`);
    }
    const maxLength = field.maxLength ?? (field.type === "textarea" ? 2000 : 300);
    result[field.id] = value.slice(0, Math.max(1, Math.min(maxLength, 2000)));
  }
  return result;
}

type UploadFileForValidation = {
  originalname: string;
  size: number;
};

function validateUploadFiles(files: UploadFileForValidation[], rules: FilestoreRules) {
  if (!files.length) throw filestoreApiError(400, "至少需要上传一个文件");
  if (files.length > rules.maxCount) throw filestoreApiError(400, `最多只能上传 ${rules.maxCount} 个文件`);
  const allowed = new Set(rules.allowedTypes);
  const maxBytes = rules.maxSizeMb * 1024 * 1024;
  for (const file of files) {
    const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
    if (allowed.size && !allowed.has(ext)) throw filestoreApiError(400, `${file.originalname} 类型不允许`);
    if (file.size > maxBytes) throw filestoreApiError(400, `${file.originalname} 超过 ${rules.maxSizeMb} MB`);
  }
}

function normalizeDirectUploadFiles(input: unknown) {
  if (!Array.isArray(input)) throw filestoreApiError(400, "文件列表格式不正确");
  return input.slice(0, 50).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = normalizeUploadOriginalName(row.name ?? row.originalName).slice(0, 255);
    const size = Number(row.size);
    const type = String(row.type ?? row.mimeType ?? "").trim().slice(0, 120) || "application/octet-stream";
    if (!name) throw filestoreApiError(400, "文件名不能为空");
    if (!Number.isFinite(size) || size < 0 || size > Number.MAX_SAFE_INTEGER) {
      throw filestoreApiError(400, `${name} 大小不正确`);
    }
    return {
      originalname: name,
      size: Math.round(size),
      mimetype: type,
    };
  });
}

function parseNumericIdList(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap((item) => parseNumericIdList(item));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        return parseNumericIdList(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return trimmed.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
  }
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? [numberValue] : [];
}

function buildFileCollectRelativePath(taskId: number, physicalName: string) {
  return path.posix.join("file-collect", String(taskId), physicalName);
}

async function saveUploadedFileCollectAsset(relativePath: string, file: Express.Multer.File) {
  const buffer = await readFile(file.path);
  await saveMediaAsset({
    relativePath,
    buffer,
    contentType: file.mimetype || "application/octet-stream",
  });
  await unlink(file.path).catch(() => null);
}

function buildFileCollectRemoteRelativePath(taskId: number, submissionId: number, index: number, storedName: string) {
  return path.posix.join("file-collect", String(taskId), String(submissionId), String(index), safeStoredFilename(storedName));
}

function remoteDownloadNameMatchesStoredName(remoteName: string | null | undefined, storedName: string) {
  return safeStoredFilename(String(remoteName || "")) === safeStoredFilename(storedName);
}

function shouldFilestoreFileUseRemote(size: number, minSizeBytes: number) {
  if (minSizeBytes <= 0) return true;
  return Number(size || 0) >= minSizeBytes;
}

async function filestoreRemoteUploadPolicy(taskId: number, files: Array<{ size: number }> = []) {
  const runtime = await getMediaStorageRuntimeConfig();
  const remoteReady = Boolean(
    (runtime.oneDriveChinaRefreshToken.trim() || runtime.legacyClientSecret.trim())
    && (runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim()),
  );
  const available = remoteReady
    && await shouldUseRemoteMediaStorageForRelativePath(buildFileCollectRelativePath(taskId, "__probe__"));
  const minSizeMb = Math.max(0, Number(runtime.filestoreRemoteMinSizeMb || 0));
  const minSizeBytes = Math.round(minSizeMb * 1024 * 1024);
  const triggered = !files.length || files.some((file) => shouldFilestoreFileUseRemote(Number(file.size || 0), minSizeBytes));
  return {
    available,
    shouldDirect: available && triggered,
    minSizeMb,
    minSizeBytes,
  };
}

async function resolveFileCollectRemoteAccess(file: { path: string; size: number; storedName: string }) {
  const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
  if (!meta || meta.kind !== "file") return { url: "", downloadNameSafe: false };
  return {
    url: meta.downloadUrl || await resolveOneDriveChinaDirectDownloadUrl(file.path).catch(() => ""),
    downloadNameSafe: remoteDownloadNameMatchesStoredName(meta.name, file.storedName),
  };
}

async function waitForFileCollectRemoteUpload(file: { path: string; size: number; storedName: string }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
    if (meta?.kind === "file") {
      if (meta.size !== null && Number(meta.size) !== Number(file.size)) {
        console.warn(`[filestore] direct upload size metadata differs for ${file.path}: expected=${file.size} remote=${meta.size}`);
      }
      return true;
    }
    await sleep(500 + attempt * 350);
  }
  return false;
}

async function rerenameFilestoreTaskFiles(taskId: number, renameTemplate: string) {
  return prisma.$transaction(async (tx) => {
    await acquireFileCollectTaskLock(tx, taskId);
    const rows = await tx.fileCollectSubmission.findMany({
      where: { taskId, status: "submitted" },
      include: { files: { orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
    const result = { renamed: 0, unchanged: 0, missing: 0 };
    for (const submission of rows) {
      const data = parseJsonObject(submission.data);
      const total = submission.files.length;
      for (let index = 0; index < submission.files.length; index += 1) {
        const file = submission.files[index];
        const storedName = renderStoredName(renameTemplate, data, file.originalName, index + 1, total);
        if (storedName === file.storedName) {
          result.unchanged += 1;
          continue;
        }
        await tx.fileCollectFile.update({ where: { id: file.id }, data: { storedName } });
        result.renamed += 1;
      }
    }
    return result;
  }, { timeout: 120_000 });
}

async function repairFileCollectRemoteFilenames(
  taskId: number,
  user: FilestoreAccessUser | null,
) {
  return prisma.$transaction(async (tx) => {
    await acquireFileCollectTaskLock(tx, taskId);
    const task = await tx.fileCollectTask.findUnique({ where: { id: taskId } });
    if (!task || !canAccessFilestoreTask(user, task)) {
      throw filestoreApiError(404, "任务不存在");
    }
    if (normalizeFilestoreStatus(task.status) === "open") {
      throw filestoreApiError(409, "请先停止任务提交，再修复远端文件名");
    }
    const uploadingCount = await tx.fileCollectSubmission.count({
      where: { taskId, status: "uploading" },
    });
    if (uploadingCount) {
      throw filestoreApiError(409, "仍有未完成上传，暂不能修复远端文件名");
    }
    const submissions = await tx.fileCollectSubmission.findMany({
      where: { taskId, status: "submitted" },
      include: { files: { orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
    const result = {
      scanned: 0,
      repaired: 0,
      synced: 0,
      unchanged: 0,
      skippedLocal: 0,
      conflicts: 0,
      failed: 0,
      details: [] as Array<{ fileId: number; storedName: string; from: string; to: string; status: string; message?: string }>,
    };

    for (const submission of submissions) {
      for (let index = 0; index < submission.files.length; index += 1) {
        const file = submission.files[index];
        result.scanned += 1;
        const targetPath = buildFileCollectRemoteRelativePath(taskId, submission.id, index + 1, file.storedName);
        const detail = { fileId: file.id, storedName: file.storedName, from: file.path, to: targetPath, status: "", message: "" };
        const currentMeta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
        if (file.path === targetPath && currentMeta?.kind === "file" && remoteDownloadNameMatchesStoredName(currentMeta.name, file.storedName)) {
          result.unchanged += 1;
          detail.status = "unchanged";
          result.details.push(detail);
          continue;
        }

        const targetMeta = file.path === targetPath
          ? null
          : await getOneDriveChinaItemMetadata(targetPath).catch(() => null);
        if (targetMeta?.kind === "file") {
          if (currentMeta?.kind === "file" && file.path !== targetPath) {
            result.conflicts += 1;
            detail.status = "conflict";
            detail.message = "当前路径和目标路径都存在文件，已跳过以避免误删";
            result.details.push(detail);
            continue;
          }
          if (targetMeta.size === null || Number(targetMeta.size) === Number(file.size)) {
            await tx.fileCollectFile.update({ where: { id: file.id }, data: { path: targetPath } });
            result.synced += 1;
            detail.status = "synced";
            detail.message = "目标文件已存在，已同步数据库路径";
            result.details.push(detail);
            continue;
          }
          result.conflicts += 1;
          detail.status = "conflict";
          detail.message = "目标位置已有同名文件且大小不一致";
          result.details.push(detail);
          continue;
        }

        if (!currentMeta || currentMeta.kind !== "file") {
          result.skippedLocal += 1;
          detail.status = "skipped";
          detail.message = "未在世纪互联找到当前文件，可能是本地文件或远端已被移除";
          result.details.push(detail);
          continue;
        }

        try {
          await moveOneDriveChinaItem(file.path, targetPath);
          await tx.fileCollectFile.update({ where: { id: file.id }, data: { path: targetPath } });
          result.repaired += 1;
          detail.status = "repaired";
          result.details.push(detail);
        } catch (error) {
          result.failed += 1;
          detail.status = "failed";
          detail.message = error instanceof Error ? error.message : "修复失败";
          result.details.push(detail);
        }
      }
    }

    return result;
  }, { timeout: 15 * 60 * 1000 });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function surveyAnswerText(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).join("; ") : String(value ?? "");
}

function filenameHeader(name: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function handleFilestoreUtilityRoute(req: Request, res: Response, user: FilestoreAccessUser | null) {
  const target = upstreamPath(req).split("?")[0];
  if (req.method === "GET" && target === "/api/health") {
    res.json({ ok: true, time: new Date().toISOString() });
    return true;
  }
  if (req.method === "GET" && target === "/api/qrcode") {
    const data = queryStringValue(req.query.data).trim();
    if (!data) {
      res.status(400).type("text/plain; charset=utf-8").send("二维码内容不能为空");
      return true;
    }
    if (data.length > 4096) {
      res.status(400).type("text/plain; charset=utf-8").send("二维码内容过长");
      return true;
    }
    const requestedSize = Number(queryStringValue(req.query.size));
    const width = Number.isFinite(requestedSize)
      ? Math.min(640, Math.max(120, Math.round(requestedSize)))
      : 260;
    const png = await QRCode.toBuffer(data, {
      type: "png",
      width,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#172033",
        light: "#ffffffff",
      },
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(png);
    return true;
  }
  if (req.method === "GET" && target === "/api/platform/site-config") {
    res.json({
      siteFilingNumber: getSiteFilingNumber(),
    });
    return true;
  }
  if (req.method === "GET" && target === "/api/admin/me") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    res.json({
      ok: true,
      role: user.role,
      isSuperAdmin: userIsSuperAdmin(user),
      isManager: userCanManageGlobalFilestore(user),
      user: {
        userId: user.userId,
        username: user.username,
        displayName: user.nickname || user.username,
      },
      settings: await filestoreSettings(),
    });
    return true;
  }
  if (req.method === "GET" && target === "/api/settings") {
    if (!userCanManageGlobalFilestore(user)) {
      res.status(403).json({ error: "仅文件收集管理器可操作全局配置" });
      return true;
    }
    res.json(await filestoreSettings());
    return true;
  }
  if (req.method === "POST" && target === "/api/settings") {
    if (!userCanManageGlobalFilestore(user)) {
      res.status(403).json({ error: "仅文件收集管理器可操作全局配置" });
      return true;
    }
    const payload = await parseFilestoreJsonBody(req, res);
    if (payload.siteUrl !== undefined) {
      await setFilestoreSiteSetting(FILESTORE_SITE_URL_KEY, normalizeSiteUrl(payload.siteUrl));
    }
    if (payload.siteTitle !== undefined) {
      await setFilestoreSiteSetting(FILESTORE_SITE_TITLE_KEY, normalizeSiteTitle(payload.siteTitle));
    }
    if (payload.taskTemplates !== undefined) {
      if (!Array.isArray(payload.taskTemplates)) throw filestoreApiError(400, "模板数据格式不正确");
      await saveFilestoreTemplates(payload.taskTemplates);
    }
    res.json(await filestoreSettings());
    return true;
  }
  if (req.method === "GET" && target === "/api/tasks") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    const rows = await prisma.fileCollectTask.findMany({
      where: userIsSuperAdmin(user) ? {} : { createdById: user.userId },
      orderBy: [{ createdAt: "desc" }],
      include: taskInclude(false),
    });
    res.json(rows.map((row) => normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user) })));
    return true;
  }
  if (req.method === "POST" && target === "/api/tasks") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    const payload = normalizeFilestoreTaskPayload(await parseFilestoreJsonBody(req, res));
    const now = new Date();
    const row = await prisma.fileCollectTask.create({
      data: {
        slug: await nextFilestoreToken(),
        title: payload.title,
        description: payload.description || null,
        status: payload.status,
        visibility: "public",
        fields: JSON.stringify(storedFields(payload.fields)),
        surveyFields: JSON.stringify(storedSurveyFields(payload.surveyFields)),
        fileRules: JSON.stringify(payload.fileRules),
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries,
        deadline: payload.deadline,
        createdById: user.userId,
        publishedAt: payload.status === "open" ? now : null,
        closedAt: payload.status === "closed" ? now : null,
      },
      include: taskInclude(true),
    });
    res.status(201).json(normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }));
    return true;
  }
  const publicTaskMatch = target.match(/^\/api\/public\/tasks\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && publicTaskMatch) {
    const row = await prisma.fileCollectTask.findUnique({
      where: { slug: publicTaskMatch[1] },
      include: taskInclude(false),
    });
    if (!row) {
      res.status(404).json({ error: "提交链接不存在" });
      return true;
    }
    const remoteUploadPolicy = await filestoreRemoteUploadPolicy(row.id).catch(() => ({
      available: false,
      shouldDirect: false,
      minSizeMb: 0,
      minSizeBytes: 0,
    }));
    res.json({
      ...normalizeFilestoreTask(row),
      siteTitle: (await filestoreSettings()).siteTitle,
      remoteUpload: {
        enabled: remoteUploadPolicy.available,
        mode: remoteUploadPolicy.available ? "onedrive-cn" : "local",
        minSizeMb: remoteUploadPolicy.minSizeMb,
        minSizeBytes: remoteUploadPolicy.minSizeBytes,
      },
    });
    return true;
  }
  const publicStatusMatch = target.match(/^\/api\/public\/status\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && publicStatusMatch) {
    const row = await prisma.fileCollectTask.findUnique({
      where: { slug: publicStatusMatch[1] },
      include: taskInclude(true),
    });
    if (!row) {
      res.status(404).json({ error: "成功名单不存在" });
      return true;
    }
    const detail = normalizeFilestoreTask(row, { includeSubmissions: true }) as any;
    const fieldKeys = (detail.fields ?? []).map((field: FilestoreField) => field.key);
    res.json({
      title: detail.title,
      deadline: detail.deadline,
      status: detail.status,
      siteTitle: (await filestoreSettings()).siteTitle,
      stats: {
        submitted: detail.stats.submitted,
        expected: detail.stats.expected,
        missing: detail.stats.missing.length,
      },
      submissions: detail.submissions.map((item: any) => {
        let displayName = String(item.data.name || "").trim();
        let identity = String(item.data.student_id || "").trim();
        if (!displayName && fieldKeys.length) displayName = String(item.data[fieldKeys[0]] || "").trim();
        if (!identity) {
          for (const key of fieldKeys) {
            const value = String(item.data[key] || "").trim();
            if (value && value !== displayName) {
              identity = value;
              break;
            }
          }
        }
        return {
          id: item.id,
          displayName: displayName || `提交 #${item.id}`,
          identity,
          createdAt: item.createdAt,
          files: item.files.map((file: any) => ({
            storedName: file.storedName,
            size: file.size,
          })),
        };
      }),
    });
    return true;
  }
  const taskDetailMatch = target.match(/^\/api\/tasks\/(\d+)$/);
  if (req.method === "GET" && taskDetailMatch) {
    const row = await getFilestoreTaskForActor(Number(taskDetailMatch[1]), user, true);
    if (!row) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    res.json(normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }));
    return true;
  }
  if (req.method === "PATCH" && taskDetailMatch) {
    const current = await getFilestoreTaskForActor(Number(taskDetailMatch[1]), user, false);
    if (!current) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    const rawPayload = await parseFilestoreJsonBody(req, res);
    const payload = normalizeFilestoreTaskPayload(rawPayload);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await acquireFileCollectTaskLock(tx, current.id);
      const locked = await tx.fileCollectTask.findUnique({ where: { id: current.id } });
      if (!locked || !canAccessFilestoreTask(user, locked)) {
        throw filestoreApiError(404, "任务不存在");
      }
      await tx.fileCollectTask.update({
        where: { id: current.id },
        data: {
          title: payload.title,
          description: payload.description || null,
          status: payload.status,
          fields: JSON.stringify(storedFields(payload.fields)),
          surveyFields: JSON.stringify(storedSurveyFields(payload.surveyFields)),
          fileRules: JSON.stringify(payload.fileRules),
          renameTemplate: payload.renameTemplate,
          folderTemplate: payload.folderTemplate,
          expectedEntries: payload.expectedEntries,
          deadline: payload.deadline,
          publishedAt: payload.status === "open" && !locked.publishedAt ? now : undefined,
          closedAt: payload.status === "closed" ? now : payload.status === "open" ? null : undefined,
        },
      });
    });
    const renameResult = rawPayload.renameExistingFiles
      ? await rerenameFilestoreTaskFiles(current.id, payload.renameTemplate)
      : null;
    const row = await getFilestoreTaskForActor(current.id, user, true);
    const detail = normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }) as any;
    if (renameResult) detail.renameResult = renameResult;
    res.json(detail);
    return true;
  }
  const repairFilenamesMatch = target.match(/^\/api\/tasks\/(\d+)\/repair-filenames$/);
  if (req.method === "POST" && repairFilenamesMatch) {
    const current = await getFilestoreTaskForActor(Number(repairFilenamesMatch[1]), user, false);
    if (!current) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    res.json(await repairFileCollectTaskFilenames(current.id));
    return true;
  }
  const repairRemoteFilenamesMatch = target.match(/^\/api\/tasks\/(\d+)\/repair-remote-filenames$/);
  if (req.method === "POST" && repairRemoteFilenamesMatch) {
    const current = await getFilestoreTaskForActor(Number(repairRemoteFilenamesMatch[1]), user, false);
    if (!current) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    res.json(await repairFileCollectRemoteFilenames(current.id, user));
    return true;
  }
  if (req.method === "DELETE" && taskDetailMatch) {
    const current = await getFilestoreTaskForActor(Number(taskDetailMatch[1]), user, false);
    if (!current) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    const paths = await prisma.$transaction(async (tx) => {
      await acquireFileCollectTaskLock(tx, current.id);
      const locked = await tx.fileCollectTask.findUnique({ where: { id: current.id } });
      if (!locked || !canAccessFilestoreTask(user, locked)) {
        throw filestoreApiError(404, "任务不存在");
      }
      await assertNoActiveFileCollectUploads(
        tx,
        current.id,
        () => filestoreApiError(409, "仍有文件正在上传，请稍后再删除任务"),
      );
      const files = await tx.fileCollectFile.findMany({
        where: { submission: { taskId: current.id } },
        select: { path: true },
      });
      await tx.fileCollectTask.delete({ where: { id: current.id } });
      return files.map((file) => file.path);
    });
    await Promise.all(paths.map((relativePath) => unlinkFileCollectPath(relativePath)));
    await rm(path.resolve(process.cwd(), "uploads", "file-collect", String(current.id)), { recursive: true, force: true });
    res.json({ ok: true });
    return true;
  }
  const ownerMatch = target.match(/^\/api\/tasks\/(\d+)\/owner$/);
  if (req.method === "PATCH" && ownerMatch) {
    if (!userIsSuperAdmin(user)) {
      res.status(403).json({ error: "仅超级管理员可操作" });
      return true;
    }
    const taskId = Number(ownerMatch[1]);
    const payload = await parseFilestoreJsonBody(req, res);
    const userId = Number(payload.userId);
    if (!Number.isInteger(userId) || userId <= 0) throw filestoreApiError(400, "绑定用户 ID 无效");
    await prisma.$transaction(async (tx) => {
      await acquireFileCollectTaskLock(tx, taskId);
      const task = await tx.fileCollectTask.findUnique({ where: { id: taskId } });
      if (!task) throw filestoreApiError(404, "任务不存在");
      const owner = await tx.user.findFirst({
        where: {
          id: userId,
          status: { not: "banned" },
          OR: [
            { role: "admin" },
            { toolPermissions: { some: { toolCode: "file_collect" } } },
          ],
        },
        select: { id: true },
      });
      if (!owner) throw filestoreApiError(400, "未找到可绑定的文件收集管理员");
      await tx.fileCollectTask.update({ where: { id: task.id }, data: { createdById: userId } });
    });
    const row = await getFilestoreTaskForActor(taskId, user, true);
    res.json(normalizeFilestoreTask(row, { includeCreator: true, includeSubmissions: true }));
    return true;
  }
  const exportMatch = target.match(/^\/api\/tasks\/(\d+)\/export\.csv$/);
  if (req.method === "GET" && exportMatch) {
    const row = await getFilestoreTaskForActor(Number(exportMatch[1]), user, true);
    if (!row) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    const detail = normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }) as any;
    const fields = detail.fields as FilestoreField[];
    const surveyFields = detail.surveyFields as FilestoreSurveyField[];
    const headers = ["提交编号", "提交时间", "IP", ...fields.map((field) => field.label), ...surveyFields.map((field) => field.label), "文件"];
    const lines = [headers.map(csvCell).join(",")];
    for (const submission of detail.submissions) {
      lines.push([
        submission.id,
        submission.createdAt,
        submission.ip,
        ...fields.map((field) => submission.data[field.key] || ""),
        ...surveyFields.map((field) => surveyAnswerText(submission.answers?.[field.id])),
        submission.files.map((file: any) => file.storedName).join("; "),
      ].map(csvCell).join(","));
    }
    const body = `\uFEFF${lines.join("\r\n")}\r\n`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", filenameHeader(`${detail.title}.csv`));
    res.send(body);
    return true;
  }
  const zipMatch = target.match(/^\/api\/tasks\/(\d+)\/download\.zip$/);
  if (req.method === "GET" && zipMatch) {
    res.status(410).json({ error: "ZIP 已改为浏览器端打包，请在管理界面点击下载 ZIP" });
    return true;
  }
  const checkDuplicateSubmitMatch = target.match(/^\/api\/submit\/([A-Za-z0-9_-]+)\/check-duplicate$/);
  if (req.method === "POST" && checkDuplicateSubmitMatch) {
    const payload = await parseFilestoreJsonBody(req, res);
    const task = await prisma.fileCollectTask.findUnique({ where: { slug: checkDuplicateSubmitMatch[1] } });
    if (!task) throw filestoreApiError(404, "提交链接不存在");
    if (normalizeFilestoreStatus(task.status) !== "open") throw filestoreApiError(400, "任务未开放提交");
    if (task.deadline && Date.now() > task.deadline.getTime()) throw filestoreApiError(400, "已超过截止时间");
    const fields = parseStoredFields(task.fields);
    const dataSource = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : payload;
    const data = normalizeSubmissionData(fields, dataSource);
    const identity = submissionIdentity(data, fields);
    const identityLabel = submissionIdentityLabel(data, fields);
    const existing = await findExistingSubmittedFilestoreSubmission(task.id, identity);
    const duplicate = existing ? duplicateSubmissionPayload(existing, identity, identityLabel) : null;
    res.json({
      ok: true,
      exists: Boolean(existing),
      identity,
      identityLabel,
      submission: duplicate?.submission ?? null,
    });
    return true;
  }
  const prepareRemoteSubmitMatch = target.match(/^\/api\/submit\/([A-Za-z0-9_-]+)\/prepare-remote$/);
  if (req.method === "POST" && prepareRemoteSubmitMatch) {
    const payload = await parseFilestoreJsonBody(req, res);
    const task = await prisma.fileCollectTask.findUnique({ where: { slug: prepareRemoteSubmitMatch[1] } });
    if (!task) throw filestoreApiError(404, "提交链接不存在");
    assertFilestoreTaskAcceptsSubmission(task);
    const remotePolicy = await filestoreRemoteUploadPolicy(task.id);
    if (!remotePolicy.available) {
      throw filestoreApiError(400, "当前任务未启用世纪互联直传");
    }
    const fields = parseStoredFields(task.fields);
    const rules = parseStoredRules(task.fileRules);
    const dataSource = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : payload;
    const data = normalizeSubmissionData(fields, dataSource);
    const surveyFields = parseStoredSurveyFields(task.surveyFields);
    const answers = normalizeSurveyAnswers(surveyFields, normalizeSurveyAnswerInput(payload.answers));
    const files = normalizeDirectUploadFiles(payload.files);
    validateUploadFiles(files, rules);
    const uploadPolicy = await filestoreRemoteUploadPolicy(task.id, files);
    if (!uploadPolicy.shouldDirect) {
      throw filestoreApiError(400, "所选文件未达到世纪互联直传阈值，请使用普通上传");
    }
    const directFileIndexes = new Set(
      files
        .map((file, index) => ({ file, index }))
        .filter(({ file }) => shouldFilestoreFileUseRemote(file.size, uploadPolicy.minSizeBytes))
        .map(({ index }) => index),
    );
    const identity = submissionIdentity(data, fields);
    const identityLabel = submissionIdentityLabel(data, fields);
    const overwrite = parseOverwriteFlag(payload.overwrite ?? payload.overwriteConfirmed);
    const lockIdentity = identity || `anonymous:${randomUUID()}`;

    const created = await prisma.$transaction(async (tx) => {
      await acquireFileCollectSubmissionLock(tx, task.id, lockIdentity);
      const lockedTask = await tx.fileCollectTask.findUnique({ where: { id: task.id } });
      if (!lockedTask) throw filestoreApiError(404, "提交链接不存在");
      assertFilestoreTaskAcceptsSubmission(lockedTask);
      const existing = identity
        ? await tx.fileCollectSubmission.findFirst({
          where: { taskId: task.id, identity, status: "submitted" },
          orderBy: { createdAt: "desc" },
          include: { files: { orderBy: { id: "asc" } } },
        })
        : null;
      assertCanCreateOrOverwriteExisting(existing, identity, identityLabel, overwrite);

      const stalePaths = await removeStaleFileCollectUploadsForIdentity(
        tx,
        task.id,
        identity,
        () => filestoreApiError(409, "同一身份的文件正在上传，请稍后重试"),
      );

      const submission = await tx.fileCollectSubmission.create({
        data: {
          taskId: lockedTask.id,
          submitterId: null,
          identity,
          data: JSON.stringify(data),
          answers: JSON.stringify(answers),
          ip: req.ip,
          status: "uploading",
        },
      });
      const fileRows = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const storedName = renderStoredName(lockedTask.renameTemplate, data, file.originalname, index + 1, files.length);
        const relativePath = directFileIndexes.has(index)
          ? buildFileCollectRemoteRelativePath(lockedTask.id, submission.id, index + 1, storedName)
          : buildFileCollectRelativePath(lockedTask.id, `${submission.id}-${index + 1}-${randomUUID()}-${safeStoredFilename(storedName)}`);
        fileRows.push(await tx.fileCollectFile.create({
          data: {
            submissionId: submission.id,
            originalName: file.originalname,
            storedName,
            mimeType: file.mimetype || "application/octet-stream",
            size: file.size,
            path: relativePath,
          },
        }));
      }
      return { submission, files: fileRows, stalePaths };
    });
    await Promise.all(created.stalePaths.map((relativePath) => unlinkFileCollectPath(relativePath)));

    try {
      const uploadFiles = [];
      const localFiles = [];
      for (let index = 0; index < created.files.length; index += 1) {
        const file = created.files[index];
        if (!directFileIndexes.has(index)) {
          localFiles.push({
            id: file.id,
            index,
            originalName: file.originalName,
            storedName: file.storedName,
            size: file.size,
            mimeType: file.mimeType,
          });
          continue;
        }
        if (file.size <= 0) throw filestoreApiError(400, `${file.storedName} 是空文件，暂不支持直传`);
        const session = await createRemoteMediaUploadSession({
          relativePath: file.path,
          contentType: file.mimeType || "application/octet-stream",
        });
        if (!session) throw filestoreApiError(400, "当前任务未启用世纪互联直传");
        uploadFiles.push({
          id: file.id,
          index,
          originalName: file.originalName,
          storedName: file.storedName,
          size: file.size,
          mimeType: file.mimeType,
          uploadUrl: session.uploadUrl,
          expiresAt: session.expiresAt,
        });
      }
      res.json({
        ok: true,
        directUpload: true,
        submissionId: created.submission.id,
        completionToken: signFileCollectCompletionToken(created.submission),
        files: uploadFiles,
        localFiles,
      });
    } catch (error) {
      const pendingPaths = await deleteUploadingFileCollectSubmission(created.submission.id).catch(() => [] as string[]);
      await Promise.all(
        [...new Set([...created.files.map((file) => file.path), ...pendingPaths])]
          .map((relativePath) => unlinkFileCollectPath(relativePath)),
      );
      throw error;
    }
    return true;
  }
  const completeRemoteSubmitMatch = target.match(/^\/api\/submit\/([A-Za-z0-9_-]+)\/complete-remote$/);
  if (req.method === "POST" && completeRemoteSubmitMatch) {
    let uploadedFiles: Express.Multer.File[] = [];
    const movedPaths: string[] = [];
    const knownSubmissionPaths: string[] = [];
    let completionAuthorized = false;
    let completionSubmissionId = 0;
    try {
      const contentType = String(req.headers["content-type"] || "");
      const isMultipart = contentType.includes("multipart/form-data");
      let body: Record<string, unknown>;
      if (isMultipart) {
        uploadedFiles = await parseFilestoreUpload(req, res);
        body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
      } else {
        body = await parseFilestoreJsonBody(req, res);
      }
      const submissionId = Number(body.submissionId ?? body.id);
      if (!Number.isInteger(submissionId) || submissionId <= 0) throw filestoreApiError(400, "提交编号无效");
      completionSubmissionId = submissionId;
      const submission = await prisma.fileCollectSubmission.findUnique({
        where: { id: submissionId },
        include: {
          task: true,
          files: { orderBy: { id: "asc" } },
        },
      });
      if (!submission || submission.task.slug !== completeRemoteSubmitMatch[1]) {
        throw filestoreApiError(404, "提交记录不存在");
      }
      knownSubmissionPaths.push(...submission.files.map((file) => file.path));
      if (!verifyFileCollectCompletionToken(String(body.completionToken || ""), submission)) {
        throw filestoreApiError(403, "提交确认凭证无效或已过期，请重新上传");
      }
      completionAuthorized = true;
      if (submission.status === "submitted") {
        res.json({
          ok: true,
          id: submission.id,
          submissionId: submission.id,
          createdAt: isoDate(submission.createdAt),
          files: submission.files.map((file) => file.storedName),
        });
        return true;
      }
      if (submission.status !== "uploading") throw filestoreApiError(400, "提交状态无法完成");
      if (!submission.files.length) throw filestoreApiError(400, "没有待确认文件");
      assertFilestoreTaskAcceptsSubmission(submission.task);

      const uploadPolicy = await filestoreRemoteUploadPolicy(submission.taskId, submission.files);
      const expectedRemoteFiles = uploadPolicy.available
        ? submission.files.filter((file) => shouldFilestoreFileUseRemote(file.size, uploadPolicy.minSizeBytes))
        : [];
      const expectedRemoteIds = new Set(expectedRemoteFiles.map((file) => file.id));
      const expectedLocalFiles = submission.files.filter((file) => !expectedRemoteIds.has(file.id));
      const confirmedRemoteIds = new Set(parseNumericIdList(body.remoteFileIds));
      const submittedLocalIds = parseNumericIdList(body.localFileIds);
      const overwrite = parseOverwriteFlag(body.overwrite ?? body.overwriteConfirmed);
      if (confirmedRemoteIds.size && expectedRemoteFiles.some((file) => !confirmedRemoteIds.has(file.id))) {
        throw filestoreApiError(400, "直传文件列表不完整，请刷新后重试");
      }
      if (expectedLocalFiles.length) {
        if (submittedLocalIds.length !== expectedLocalFiles.length) {
          throw filestoreApiError(400, "本地文件列表不完整，请刷新后重试");
        }
        const expectedLocalIds = new Set(expectedLocalFiles.map((file) => file.id));
        if (submittedLocalIds.some((id) => !expectedLocalIds.has(id))) {
          throw filestoreApiError(400, "本地文件列表与提交记录不匹配");
        }
      }
      if (uploadedFiles.length !== expectedLocalFiles.length) {
        throw filestoreApiError(400, "本地文件数量与提交记录不匹配");
      }

      for (const file of expectedRemoteFiles) {
        const uploaded = await waitForFileCollectRemoteUpload(file);
        if (!uploaded) throw filestoreApiError(400, `${file.storedName} 尚未上传完成`);
      }

      const submissionData = parseJsonObject(submission.data);
      const submissionFields = parseStoredFields(submission.task.fields);
      const identityLabel = submissionIdentityLabel(submissionData, submissionFields);

      if (expectedLocalFiles.length) {
        const localById = new Map(expectedLocalFiles.map((file) => [file.id, file]));
        for (let index = 0; index < submittedLocalIds.length; index += 1) {
          const expected = localById.get(submittedLocalIds[index]);
          const uploaded = uploadedFiles[index];
          if (!expected || !uploaded) throw filestoreApiError(400, "本地文件列表与提交记录不匹配");
          if (uploaded.size !== expected.size) throw filestoreApiError(400, `${expected.storedName} 上传大小不一致`);
          if (uploaded.originalname !== expected.originalName) throw filestoreApiError(400, `${expected.storedName} 文件名不一致`);
          await saveUploadedFileCollectAsset(expected.path, uploaded);
          movedPaths.push(expected.path);
        }
      }

      const completed = await prisma.$transaction(async (tx) => {
        await acquireFileCollectSubmissionLock(
          tx,
          submission.taskId,
          submission.identity || `pending:${submission.id}`,
        );
        const current = await tx.fileCollectSubmission.findUnique({
          where: { id: submission.id },
          include: {
            task: true,
            files: { orderBy: { id: "asc" } },
          },
        });
        if (!current || current.task.slug !== completeRemoteSubmitMatch[1]) {
          throw filestoreApiError(404, "提交记录不存在");
        }
        if (current.status === "submitted") {
          return { submission: current, stalePaths: [] as string[], alreadySubmitted: true };
        }
        if (current.status !== "uploading") throw filestoreApiError(400, "提交状态无法完成");
        assertFilestoreTaskAcceptsSubmission(current.task);

        const existing = current.identity
          ? await tx.fileCollectSubmission.findFirst({
            where: {
              taskId: current.taskId,
              identity: current.identity,
              status: "submitted",
              id: { not: current.id },
            },
            orderBy: { createdAt: "desc" },
            include: { files: { orderBy: { id: "asc" } } },
          })
          : null;
        assertCanCreateOrOverwriteExisting(existing, current.identity, identityLabel, overwrite);

        const oldPaths: string[] = [];
        if (current.identity && overwrite) {
          const oldRows = await tx.fileCollectSubmission.findMany({
            where: {
              taskId: current.taskId,
              identity: current.identity,
              status: "submitted",
              id: { not: current.id },
            },
            include: { files: true },
          });
          for (const old of oldRows) {
            await tx.fileCollectSubmission.delete({ where: { id: old.id } });
            oldPaths.push(...old.files.map((file) => file.path));
          }
        }
        await tx.fileCollectSubmission.update({
          where: { id: current.id },
          data: { status: "submitted" },
        });
        await refreshFileCollectTaskCounters(tx, current.taskId);
        return {
          submission: { ...current, status: "submitted" },
          stalePaths: oldPaths,
          alreadySubmitted: false,
        };
      });
      await Promise.all(completed.stalePaths.map((item) => unlinkFileCollectPath(item)));
      if (!completed.alreadySubmitted) {
        await notifyFileCollectSubmissionForQqBot({
          task: completed.submission.task,
          submission: {
            id: completed.submission.id,
            identity: completed.submission.identity,
            submitterId: completed.submission.submitterId,
            data: completed.submission.data,
          },
          fileCount: completed.submission.files.length,
        }).catch((error) => console.warn("[filestore] qqbot reminder failed", error));
      }
      res.json({
        ok: true,
        id: completed.submission.id,
        submissionId: completed.submission.id,
        createdAt: isoDate(completed.submission.createdAt),
        files: completed.submission.files.map((file) => file.storedName),
      });
    } catch (error) {
      await Promise.all(uploadedFiles.map((file) => unlink(file.path).catch(() => null)));
      const cleanupPaths = [...movedPaths];
      if (completionAuthorized) {
        const current = await prisma.fileCollectSubmission.findFirst({
          where: { id: completionSubmissionId },
          include: { task: true },
        }).catch(() => null);
        const terminal = !current
          || (current.status === "uploading" && (
            normalizeFilestoreStatus(current.task.status) !== "open"
            || Boolean(current.task.deadline && Date.now() > current.task.deadline.getTime())
          ));
        if (terminal) {
          const pendingPaths = current?.status === "uploading"
            ? await deleteUploadingFileCollectSubmission(current.id).catch(() => [] as string[])
            : [];
          cleanupPaths.push(...knownSubmissionPaths, ...pendingPaths);
        }
      }
      await Promise.all([...new Set(cleanupPaths)].map((item) => unlinkFileCollectPath(item)));
      throw error;
    }
    return true;
  }
  const submitMatch = target.match(/^\/api\/submit\/([A-Za-z0-9_-]+)$/);
  if (req.method === "POST" && submitMatch) {
    let uploadedFiles: Express.Multer.File[] = [];
    const movedPaths: string[] = [];
    let pendingSubmissionId: number | null = null;
    try {
      const task = await prisma.fileCollectTask.findUnique({ where: { slug: submitMatch[1] } });
      if (!task) throw filestoreApiError(404, "提交链接不存在");
      assertFilestoreTaskAcceptsSubmission(task);
      uploadedFiles = await parseFilestoreUpload(req, res);
      const fields = parseStoredFields(task.fields);
      const rules = parseStoredRules(task.fileRules);
      const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
      const data = normalizeSubmissionData(fields, body);
      const surveyFields = parseStoredSurveyFields(task.surveyFields);
      const answers = normalizeSurveyAnswers(surveyFields, normalizeSurveyAnswerInput(body.answers));
      validateUploadFiles(uploadedFiles, rules);
      if ((await filestoreRemoteUploadPolicy(task.id, uploadedFiles)).shouldDirect) {
        throw filestoreApiError(400, "本次提交包含达到直传阈值的文件，请刷新页面后重试");
      }
      const identity = submissionIdentity(data, fields);
      const identityLabel = submissionIdentityLabel(data, fields);
      const overwrite = parseOverwriteFlag(body.overwrite ?? body.overwriteConfirmed);
      const lockIdentity = identity || `anonymous:${randomUUID()}`;
      const pending = await prisma.$transaction(async (tx) => {
        await acquireFileCollectSubmissionLock(tx, task.id, lockIdentity);
        const lockedTask = await tx.fileCollectTask.findUnique({ where: { id: task.id } });
        if (!lockedTask) throw filestoreApiError(404, "提交链接不存在");
        assertFilestoreTaskAcceptsSubmission(lockedTask);

        const existing = identity
          ? await tx.fileCollectSubmission.findFirst({
            where: { taskId: task.id, identity, status: "submitted" },
            orderBy: { createdAt: "desc" },
            include: { files: { orderBy: { id: "asc" } } },
          })
          : null;
        assertCanCreateOrOverwriteExisting(existing, identity, identityLabel, overwrite);

        const stalePaths = await removeStaleFileCollectUploadsForIdentity(
          tx,
          task.id,
          identity,
          () => filestoreApiError(409, "同一身份的文件正在上传，请稍后重试"),
        );
        const submission = await tx.fileCollectSubmission.create({
          data: {
            taskId: lockedTask.id,
            submitterId: null,
            identity,
            data: JSON.stringify(data),
            answers: JSON.stringify(answers),
            ip: req.ip,
            status: "uploading",
          },
        });
        return { submission, task: lockedTask, stalePaths };
      });
      pendingSubmissionId = pending.submission.id;
      await Promise.all(pending.stalePaths.map((relativePath) => unlinkFileCollectPath(relativePath)));

      const fileData: Array<{
        originalName: string;
        storedName: string;
        mimeType: string;
        size: number;
        path: string;
      }> = [];
      for (let index = 0; index < uploadedFiles.length; index += 1) {
        const file = uploadedFiles[index];
        const storedName = renderStoredName(pending.task.renameTemplate, data, file.originalname, index + 1, uploadedFiles.length);
        const physicalName = `${pending.submission.id}-${index + 1}-${randomUUID()}-${safeStoredFilename(storedName)}`;
        const relativePath = buildFileCollectRelativePath(pending.task.id, physicalName);
        await saveUploadedFileCollectAsset(relativePath, file);
        movedPaths.push(relativePath);
        fileData.push({
          originalName: file.originalname,
          storedName,
          mimeType: file.mimetype || "application/octet-stream",
          size: file.size,
          path: relativePath,
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        await acquireFileCollectSubmissionLock(tx, task.id, lockIdentity);
        const current = await tx.fileCollectSubmission.findUnique({
          where: { id: pending.submission.id },
          include: { task: true },
        });
        if (!current || current.task.slug !== submitMatch[1]) {
          throw filestoreApiError(404, "提交记录不存在");
        }
        if (current.status !== "uploading") throw filestoreApiError(409, "提交状态已发生变化，请重新提交");
        assertFilestoreTaskAcceptsSubmission(current.task);

        const existing = current.identity
          ? await tx.fileCollectSubmission.findFirst({
            where: {
              taskId: current.taskId,
              identity: current.identity,
              status: "submitted",
              id: { not: current.id },
            },
            orderBy: { createdAt: "desc" },
            include: { files: { orderBy: { id: "asc" } } },
          })
          : null;
        assertCanCreateOrOverwriteExisting(existing, current.identity, identityLabel, overwrite);

        const oldPaths: string[] = [];
        if (current.identity && overwrite) {
          const oldRows = await tx.fileCollectSubmission.findMany({
            where: {
              taskId: current.taskId,
              identity: current.identity,
              status: "submitted",
              id: { not: current.id },
            },
            include: { files: true },
          });
          for (const old of oldRows) {
            await tx.fileCollectSubmission.delete({ where: { id: old.id } });
            oldPaths.push(...old.files.map((file) => file.path));
          }
        }
        const fileRows = [];
        for (const file of fileData) {
          fileRows.push(await tx.fileCollectFile.create({
            data: {
              submissionId: current.id,
              originalName: file.originalName,
              storedName: file.storedName,
              mimeType: file.mimeType,
              size: file.size,
              path: file.path,
            },
          }));
        }
        const submission = await tx.fileCollectSubmission.update({
          where: { id: current.id },
          data: { status: "submitted" },
        });
        await refreshFileCollectTaskCounters(tx, current.taskId);
        return { submission, files: fileRows, oldPaths, task: current.task };
      });
      pendingSubmissionId = null;
      await Promise.all(result.oldPaths.map((item) => unlinkFileCollectPath(item)));
      await notifyFileCollectSubmissionForQqBot({
        task: result.task,
        submission: {
          id: result.submission.id,
          identity: result.submission.identity,
          submitterId: result.submission.submitterId,
          data: result.submission.data,
        },
        fileCount: result.files.length,
      }).catch((error) => console.warn("[filestore] qqbot reminder failed", error));
      res.json({
        ok: true,
        id: result.submission.id,
        submissionId: result.submission.id,
        createdAt: isoDate(result.submission.createdAt),
        files: result.files.map((file) => file.storedName),
      });
    } catch (error) {
      await Promise.all(uploadedFiles.map((file) => unlink(file.path).catch(() => null)));
      const pendingPaths = pendingSubmissionId
        ? await deleteUploadingFileCollectSubmission(pendingSubmissionId).catch(() => [] as string[])
        : [];
      await Promise.all(
        [...new Set([...movedPaths, ...pendingPaths])].map((item) => unlinkFileCollectPath(item)),
      );
      throw error;
    }
    return true;
  }
  const fileInfoMatch = target.match(/^\/api\/files\/(\d+)$/);
  if (req.method === "GET" && fileInfoMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileInfoMatch[1]) },
      include: { submission: { include: { task: { include: { createdBy: { select: { id: true, username: true, nickname: true, role: true } } } } } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    res.json({
      id: file.id,
      submissionId: file.submissionId,
      taskId: file.submission.taskId,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      size: file.size,
      taskTitle: file.submission.task.title,
      submissionData: parseJsonObject(file.submission.data),
      submissionCreatedAt: isoDate(file.submission.createdAt),
    });
    return true;
  }
  const fileAccessMatch = target.match(/^\/api\/files\/(\d+)\/access$/);
  if (req.method === "GET" && fileAccessMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileAccessMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    const action = new URL(req.originalUrl || req.url || "/", "http://filestore.local").searchParams.get("action") === "preview"
      ? "preview"
      : "download";
    const remoteAccess = await resolveFileCollectRemoteAccess(file);
    const remoteUrl = action === "download" && !remoteAccess.downloadNameSafe ? "" : remoteAccess.url;
    const remotePreviewUrl = action === "preview" && remoteAccess.url
      ? await resolveOneDriveChinaPreviewUrl(file.path).catch(() => "")
      : "";
    const previewToken = signFileCollectPreviewToken(file);
    const publicOfficePreviewPath = `${MOUNT_PATH}/api/files/${file.id}/public-preview/${encodeURIComponent(previewToken)}/${encodeURIComponent(file.storedName)}`;
    const publicOfficePreviewUrl = action === "preview" && !remotePreviewUrl && !remoteUrl && canUseOfficeWebViewer(file)
      ? buildFilestorePublicUrl(await getFilestoreSiteSetting(FILESTORE_SITE_URL_KEY, ""), publicOfficePreviewPath)
        || joinPublicUrl(normalizePreviewPublicOrigin(getSiteOrigin()), publicOfficePreviewPath)
        || joinPublicUrl(requestPublicOrigin(req), publicOfficePreviewPath)
      : "";
    const previewSourceUrl = action === "preview" && isOfficePreviewFile(file.storedName)
      ? publicOfficePreviewUrl
      : "";
    const viewerUrl = previewSourceUrl ? buildOfficeViewerUrl(previewSourceUrl) : "";
    const previewUrl = remotePreviewUrl || viewerUrl;
    const previewMessage = action === "preview" && isOfficePreviewFile(file.storedName) && !previewUrl
      ? officeWebViewerLimitMessage(file) || "该文件暂不支持在线预览，请下载后查看。"
      : "";
    res.json({
      ok: true,
      id: file.id,
      action,
      backend: remoteUrl ? "onedrive-cn" : "local",
      url: action === "preview" ? previewUrl : remoteUrl,
      viewer: remotePreviewUrl ? "onedrive" : (viewerUrl ? "office" : null),
      previewMessage,
      filename: file.storedName,
      mimeType: file.mimeType || "application/octet-stream",
    });
    return true;
  }
  const filePublicPreviewMatch = target.match(/^\/api\/files\/(\d+)\/public-preview(?:\/([^/]+))?(?:\/[^/]+)?$/);
  if ((req.method === "GET" || req.method === "HEAD") && filePublicPreviewMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(filePublicPreviewMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    const token = queryStringValue(req.query.token) || decodeURIComponent(filePublicPreviewMatch[2] || "");
    if (!file || !verifyFileCollectPreviewToken(token, file)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    if (!isOfficePreviewFile(file.storedName)) throw filestoreApiError(400, "该文件不支持在线预览");
    const remoteAccess = await resolveFileCollectRemoteAccess(file);
    if (remoteAccess.url) {
      res.redirect(302, remoteAccess.url);
      return true;
    }
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw filestoreApiError(404, "文件已丢失");
    res.type(file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
    res.sendFile(absolute);
    return true;
  }
  const fileDownloadMatch = target.match(/^\/api\/files\/(\d+)\/(download|preview)$/);
  if (req.method === "GET" && fileDownloadMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileDownloadMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw filestoreApiError(404, "文件已丢失");
    if (fileDownloadMatch[2] === "preview") {
      res.type(file.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
      res.sendFile(absolute);
    } else {
      res.download(absolute, file.storedName);
    }
    return true;
  }
  if (req.method === "DELETE" && fileInfoMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileInfoMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    const deletedPath = await prisma.$transaction(async (tx) => {
      await acquireFileCollectSubmissionLock(
        tx,
        file.submission.taskId,
        file.submission.identity || `submission:${file.submission.id}`,
      );
      const current = await tx.fileCollectFile.findUnique({
        where: { id: file.id },
        include: { submission: { include: { task: true } } },
      });
      if (!current || !canAccessFilestoreTask(user, current.submission.task)) {
        throw filestoreApiError(404, "文件不存在");
      }
      await tx.fileCollectFile.delete({ where: { id: current.id } });
      await refreshFileCollectTaskCounters(tx, current.submission.taskId);
      return current.path;
    });
    await unlinkFileCollectPath(deletedPath);
    res.json({ ok: true });
    return true;
  }
  const submissionMatch = target.match(/^\/api\/submissions\/(\d+)$/);
  if (req.method === "DELETE" && submissionMatch) {
    const submission = await prisma.fileCollectSubmission.findUnique({
      where: { id: Number(submissionMatch[1]) },
      include: { task: true, files: true },
    });
    if (!submission || !canAccessFilestoreTask(user, submission.task)) {
      res.status(404).json({ error: "提交记录不存在" });
      return true;
    }
    const deletedPaths = await prisma.$transaction(async (tx) => {
      await acquireFileCollectSubmissionLock(
        tx,
        submission.taskId,
        submission.identity || `submission:${submission.id}`,
      );
      const current = await tx.fileCollectSubmission.findUnique({
        where: { id: submission.id },
        include: { task: true, files: true },
      });
      if (!current || !canAccessFilestoreTask(user, current.task)) {
        throw filestoreApiError(404, "提交记录不存在");
      }
      await tx.fileCollectSubmission.delete({ where: { id: current.id } });
      await refreshFileCollectTaskCounters(tx, current.taskId);
      return current.files.map((item) => item.path);
    });
    await Promise.all(deletedPaths.map((relativePath) => unlinkFileCollectPath(relativePath)));
    res.json({ ok: true });
    return true;
  }
  if (req.method === "GET" && target === "/api/platform/users") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "仅超级管理员可绑定旧任务创建者" });
      return true;
    }
    const q = String(req.query.q ?? "").trim();
    const take = querySize(req.query.size, 8, 1, 12);
    if (!q) {
      res.json([]);
      return true;
    }
    const rows = await prisma.user.findMany({
      where: {
        status: { not: "banned" },
        OR: [
          { role: "admin" },
          { toolPermissions: { some: { toolCode: "file_collect" } } },
        ],
        AND: [
          {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { nickname: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: [{ id: "asc" }],
      take,
      select: {
        id: true,
        username: true,
        nickname: true,
        role: true,
      },
    });
    res.json(rows.map((item) => ({
      userId: item.id,
      username: item.username,
      displayName: item.nickname || item.username,
      role: item.role,
    })));
    return true;
  }
  if (req.method === "POST" && target === "/api/platform/ai/regex") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    // Parse JSON body on demand since express.json() is registered after filestoreProxy
    await new Promise<void>((resolve, reject) => {
      express.json()(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "提示词不能为空" });
      return true;
    }
    try {
      const messages = [
        {
          role: "system" as const,
          content: "你是一个正则表达式生成助手。请根据用户的自然语言描述（例如：必须以20开头，十位数字），生成且仅生成一个符合要求的 JavaScript/Python 正则表达式，并且返回一个 JSON 对象，格式为 {\"regex\": \"正则表达式\", \"description\": \"对正则表达式的简短中文解释\", \"placeholder\": \"符合此规则的输入示例（如 2018010101）\"}。注意：只能返回合法的 JSON 对象，不要用 markdown 代码块包裹，也不要有任何多余文字。"
        },
        {
          role: "user" as const,
          content: prompt
        }
      ];
      const { content } = await requestAiJson(messages);
      let parsed = { regex: "", description: "", placeholder: "" };
      try {
        const cleanContent = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        parsed = JSON.parse(cleanContent);
      } catch (err) {
        const regexMatch = content.match(/"regex"\\s*:\\s*"([^"]+)"/);
        const descMatch = content.match(/"description"\\s*:\\s*"([^"]+)"/);
        const placeholderMatch = content.match(/"placeholder"\\s*:\\s*"([^"]+)"/);
        parsed = {
          regex: regexMatch ? regexMatch[1] : "",
          description: descMatch ? descMatch[1] : "",
          placeholder: placeholderMatch ? placeholderMatch[1] : "",
        };
      }
      res.json(parsed);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "AI 生成失败" });
    }
    return true;
  }
  return false;
}

export const filestoreProxy: RequestHandler = async (req, res) => {
  try {
    const user = await assertFilestoreAccess(req, res);
    if (user === false) return;
    try {
      if (await handleFilestoreUtilityRoute(req, res, user)) return;
    } catch (error) {
      sendFilestoreApiError(res, error);
      return;
    }
    const targetPath = upstreamPath(req).split("?")[0];
    if (targetPath === "/api" || targetPath.startsWith("/api/")) {
      res.status(404).json({ error: "接口不存在" });
      return;
    }
    await ensureFilestoreStarted();
    proxyToFilestore(req, res, user);
  } catch (error) {
    res.status(503).send(error instanceof Error ? error.message : "Filestore 暂不可用");
  }
};
