import { z } from "zod";

const questionnaireBranchRuleSchema = z.object({
  action: z.enum(["end", "jump"]),
  targetId: z.string().trim().min(1).max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "字段 ID 仅支持英文、数字、下划线和中划线")
    .optional(),
}).strict();

const questionnaireFieldSchema = z.object({
  id: z.string().trim().min(1).max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "字段 ID 仅支持英文、数字、下划线和中划线"),
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "textarea", "single", "multiple", "number", "date", "rating"]),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(120).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  description: z.string().trim().max(300).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().positive().finite().optional(),
  maxLength: z.number().int().positive().max(2000).optional(),
  branching: z.record(questionnaireBranchRuleSchema).optional(),
}).strict();

const questionnaireToolCodeSchema = z.enum(["feedback", "questionnaire"]);

export const createQuestionnaireSchema = z.object({
  toolCode: questionnaireToolCodeSchema.default("questionnaire"),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  visibility: z.enum(["public", "login"]).optional(),
  allowAnonymous: z.boolean().optional(),
  oneResponsePerUser: z.boolean().optional(),
  fields: z.array(questionnaireFieldSchema).min(1).max(30),
}).strict();

export const patchQuestionnaireSchema = createQuestionnaireSchema.partial()
  .extend({
    status: z.enum(["draft", "open", "closed"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要修改一项",
  });

export const questionnaireResponseSchema = z.object({
  answers: z.record(z.union([z.string(), z.array(z.string())])),
}).strict();

export const toolQqReminderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  events: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  timing: z.enum(["instant", "after", "deadline"]).optional(),
  afterAt: z.string().datetime().nullable().optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
  beforeDeadlineHours: z.number().int().min(1).max(720).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "至少需要修改一项",
});

const gradeCheckCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const gradeCheckRowSchema = z.record(gradeCheckCellSchema);

export const createGradeCheckSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  studentIdColumn: z.string().trim().min(1).max(80).default("学号"),
  columns: z.array(z.string().trim().min(1).max(80)).min(2).max(80),
  rows: z.array(gradeCheckRowSchema).min(1).max(10000),
}).strict();

export const patchGradeCheckSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  studentIdColumn: z.string().trim().min(1).max(80).optional(),
  columns: z.array(z.string().trim().min(1).max(80)).min(2).max(80).optional(),
  rows: z.array(gradeCheckRowSchema).min(1).max(10000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "至少需要修改一项",
});

export const fileCollectFieldSchema = z.object({
  id: z.string().trim().min(1).max(40)
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, "字段 ID 仅支持中文、英文、数字和下划线"),
  label: z.string().trim().min(1).max(80),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(120).optional(),
  pattern: z.string().trim().max(200).optional(),
}).strict();

export const fileCollectRuleSchema = z.object({
  allowedTypes: z.array(
    z.string().trim().toLowerCase().regex(/^[a-z0-9]+$/),
  ).max(30).default([]),
  maxSizeMb: z.number().positive().max(100).default(20),
  maxCount: z.number().int().positive().max(20).default(1),
}).strict();

export const createFileCollectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  visibility: z.enum(["public", "login"]).optional(),
  fields: z.array(fileCollectFieldSchema).min(1).max(20),
  fileRules: fileCollectRuleSchema,
  renameTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  folderTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  expectedEntries: z.string().trim().max(20000).optional(),
}).strict();

export const patchFileCollectSchema = createFileCollectSchema.partial()
  .extend({
    status: z.enum(["draft", "open", "closed"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要修改一项",
  });

export const createFileCollectTemplateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(["public", "login"]).optional(),
  fields: z.array(fileCollectFieldSchema).min(1).max(20),
  fileRules: fileCollectRuleSchema,
  renameTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  folderTemplate: z.string().trim().min(1).max(120).default("{name}-{student_id}"),
  expectedEntries: z.string().trim().max(20000).optional(),
}).strict();

export const toolManagerCreateSchema = z.object({
  userId: z.number().int().positive().optional(),
  username: z.string().trim().min(1).max(40).optional(),
}).strict().refine((value) => value.userId || value.username, {
  message: "请选择用户或输入用户名",
});

export const toolSettingPatchSchema = z.object({
  isVisible: z.boolean().optional(),
  requireLogin: z.boolean().optional(),
  allowPublicManage: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "至少需要修改一项",
});

export type FileCollectField = z.infer<typeof fileCollectFieldSchema>;
export type FileCollectRules = z.infer<typeof fileCollectRuleSchema>;
export type CreateFileCollectInput = z.infer<typeof createFileCollectSchema>;
export type PatchFileCollectInput = z.infer<typeof patchFileCollectSchema>;
export type CreateFileCollectTemplateInput = z.infer<typeof createFileCollectTemplateSchema>;
