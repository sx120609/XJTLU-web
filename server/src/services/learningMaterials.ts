import path from "node:path";
import { z } from "zod";

export const LEARNING_MATERIAL_SEMESTERS = [
  { value: "Y1S1", label: "大一上学期" },
  { value: "Y1S2", label: "大一下学期" },
  { value: "Y2S1", label: "大二上学期" },
  { value: "Y2S2", label: "大二下学期" },
  { value: "Y3S1", label: "大三上学期" },
  { value: "Y3S2", label: "大三下学期" },
  { value: "Y4S1", label: "大四上学期" },
  { value: "Y4S2", label: "大四下学期" },
] as const;

export const LEARNING_MATERIAL_FORMATS = [
  { value: "PDF", label: "PDF" },
  { value: "DOCX", label: "Word / DOCX" },
  { value: "PPTX", label: "PowerPoint / PPTX" },
  { value: "XLSX", label: "Excel / XLSX" },
  { value: "ZIP", label: "压缩包 / ZIP" },
  { value: "TXT", label: "文本 / Markdown" },
  { value: "IMAGE", label: "图片" },
  { value: "OTHER", label: "其他" },
] as const;

export const LEARNING_MATERIAL_LANGUAGES = [
  { value: "zh-CN", label: "中文" },
  { value: "en", label: "English" },
  { value: "bilingual", label: "中英双语" },
  { value: "other", label: "其他" },
] as const;

export const LEARNING_MATERIAL_ORIGINALITY = [
  { value: "original", label: "本人原创" },
  { value: "authorized", label: "已获合法授权" },
  { value: "public_compilation", label: "基于公开资料整理" },
] as const;

export const LEARNING_MATERIAL_SUPPORT_CATEGORIES = [
  { value: "usage", label: "资料如何使用", financial: false },
  { value: "file_unavailable", label: "文件无法打开", financial: true },
  { value: "missing_content", label: "内容缺失", financial: true },
  { value: "not_as_described", label: "与商品描述不符", financial: true },
  { value: "update_request", label: "请求更新或补充", financial: false },
  { value: "duplicate_purchase", label: "重复购买", financial: true },
  { value: "copyright", label: "版权或违规问题", financial: true },
  { value: "other", label: "其他问题", financial: false },
] as const;

export const DEFAULT_LEARNING_MATERIAL_TYPES = [
  "课程笔记",
  "复习提纲",
  "知识点总结",
  "自编习题与解析",
  "实验指南",
  "项目学习指南",
  "教材补充资料",
  "思维导图与速查表",
  "课程资源包",
  "其他",
] as const;

const semesterValues = LEARNING_MATERIAL_SEMESTERS.map((item) => item.value) as [string, ...string[]];
const formatValues = new Set(LEARNING_MATERIAL_FORMATS.map((item) => item.value));
const languageValues = new Set(LEARNING_MATERIAL_LANGUAGES.map((item) => item.value));
const originalityValues = new Set(LEARNING_MATERIAL_ORIGINALITY.map((item) => item.value));

export const learningMaterialProfileInputSchema = z.object({
  courseCode: z.string().trim().max(32).optional().default(""),
  college: z.string().trim().max(120).optional().default(""),
  major: z.string().trim().max(120).optional().default(""),
  typeId: z.number().int().positive().optional().nullable(),
  applicableSemester: z.enum(semesterValues).optional().nullable(),
  fileFormats: z.array(z.string().trim().toUpperCase()).max(8).optional().default([]),
  pageCount: z.number().int().positive().max(100000).optional().nullable(),
  versionLabel: z.string().trim().max(80).optional().default(""),
  language: z.string().trim().max(30).optional().default(""),
  originalityKind: z.string().trim().max(40).optional().default(""),
  originalityStatement: z.string().trim().max(500).optional().default(""),
  rightsConfirmed: z.boolean().optional().default(false),
}).superRefine((input, ctx) => {
  if (input.courseCode && !isValidCourseCode(normalizeCourseCode(input.courseCode))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["courseCode"], message: "课程代码格式不正确" });
  }
  for (const format of input.fileFormats) {
    if (!formatValues.has(format as any)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fileFormats"], message: `不支持的文件格式：${format}` });
  }
  if (input.language && !languageValues.has(input.language as any)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["language"], message: "资料语言选项无效" });
  }
  if (input.originalityKind && !originalityValues.has(input.originalityKind as any)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["originalityKind"], message: "原创声明选项无效" });
  }
});

export type LearningMaterialProfileInput = z.infer<typeof learningMaterialProfileInputSchema>;

export function normalizeCourseCode(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidCourseCode(value: string) {
  return /^[A-Z0-9][A-Z0-9._/-]{1,31}$/.test(value);
}

export function normalizeMaterialTypeName(value: string | null | undefined) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

export function validateCustomMaterialTypeName(value: string) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) return "资料类型名称需要为 2～20 个字符";
  if (/[<>\\/]/.test(name)) return "资料类型名称包含不允许的字符";
  if (/(作业答案|代写|枪手|泄题|考试原题|盗版)/i.test(name)) return "该资料类型不允许创建";
  return "";
}

export function normalizeDeclaredFormats(formats: string[] | null | undefined) {
  return Array.from(new Set((formats || []).map((item) => item.trim().toUpperCase()).filter((item) => formatValues.has(item as any))));
}

export function parseDeclaredFormats(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? normalizeDeclaredFormats(parsed.map(String)) : [];
  } catch {
    return [];
  }
}

export function publishedMaterialProfileErrors(input: Partial<LearningMaterialProfileInput>) {
  const errors: string[] = [];
  const courseCode = normalizeCourseCode(input.courseCode);
  if (!courseCode) errors.push("请填写课程代码");
  else if (!isValidCourseCode(courseCode)) errors.push("课程代码格式不正确");
  if (!input.typeId) errors.push("请选择资料类型");
  if (!input.applicableSemester || !semesterValues.includes(input.applicableSemester)) errors.push("请选择适用学期");
  if (!input.rightsConfirmed) errors.push("请确认拥有资料的发布与售卖权利");
  return errors;
}

const FILE_FORMAT_BY_EXTENSION: Record<string, string> = {
  pdf: "PDF",
  doc: "DOCX",
  docx: "DOCX",
  ppt: "PPTX",
  pptx: "PPTX",
  xls: "XLSX",
  xlsx: "XLSX",
  zip: "ZIP",
  txt: "TXT",
  md: "TXT",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  png: "IMAGE",
  webp: "IMAGE",
};

export function learningMaterialFileFormat(fileName: string) {
  const extension = path.extname(String(fileName || "")).replace(/^\./, "").toLowerCase();
  return FILE_FORMAT_BY_EXTENSION[extension] || "";
}

export function isAllowedLearningMaterialFile(fileName: string) {
  return Boolean(learningMaterialFileFormat(fileName));
}

export function containsOffPlatformContact(content: string) {
  const value = String(content || "");
  return /(?:https?:\/\/|www\.|(?:微信|vx|wechat|qq|企鹅)\s*[:：号]?\s*[a-z0-9_-]{4,}|(?:手机|电话|手机号)\s*[:：]?\s*1[3-9]\d{9}|\b1[3-9]\d{9}\b|(?:支付宝|微信)\s*(?:转账|私下|付款))/i.test(value);
}

export function supportCategoryIsFinancial(value: string) {
  return LEARNING_MATERIAL_SUPPORT_CATEGORIES.some((item) => item.value === value && item.financial);
}
