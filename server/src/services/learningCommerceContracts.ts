import { z } from "zod";

export const LEARNING_COMMERCE_ORDER_STATUSES = [
  "pending_payment",
  "awaiting_seller_confirmation",
  "disputed",
  "delivered",
  "completed",
  "refunded",
  "cancelled",
  "expired",
] as const;

export type LearningCommerceOrderStatus = typeof LEARNING_COMMERCE_ORDER_STATUSES[number];

const transitionMap: Readonly<Record<LearningCommerceOrderStatus, readonly LearningCommerceOrderStatus[]>> = {
  pending_payment: ["awaiting_seller_confirmation", "cancelled", "expired"],
  awaiting_seller_confirmation: ["pending_payment", "disputed", "delivered", "refunded", "cancelled"],
  disputed: ["pending_payment", "delivered", "refunded", "cancelled"],
  delivered: ["completed", "refunded"],
  completed: ["refunded"],
  refunded: [],
  cancelled: [],
  expired: [],
};

export function canTransitionLearningOrder(
  from: LearningCommerceOrderStatus,
  to: LearningCommerceOrderStatus,
) {
  return transitionMap[from].includes(to);
}

export const creatorApplicationInputSchema = z.object({
  expertise: z.string().trim().min(2).max(300),
  experience: z.string().trim().min(10).max(2000),
  sampleDescription: z.string().trim().min(10).max(2000),
  rightsCommitted: z.literal(true),
}).strict();

export const creatorApplicationReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional().default(""),
}).strict().superRefine((input, context) => {
  if (input.action === "reject" && input.reason.length < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason"],
      message: "驳回申请时必须填写原因",
    });
  }
});

export const collectionMethodMetadataSchema = z.object({
  provider: z.enum(["alipay", "wechat"]),
  label: z.string().trim().max(60).optional().default(""),
}).strict();

export const materialReviewDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(2000).optional().default(""),
  checklist: z.object({
    rights: z.boolean(),
    quality: z.boolean(),
    fileSafety: z.boolean(),
  }).strict(),
}).strict().superRefine((input, context) => {
  if (input.action === "approve" && Object.values(input.checklist).some((value) => !value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checklist"],
      message: "版权、内容质量和文件安全检查全部通过后才能批准",
    });
  }
  if (input.action === "reject" && input.reason.length < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason"],
      message: "驳回资料时必须填写原因",
    });
  }
});

export const paymentEvidenceMetadataSchema = z.object({
  claimedPaidAt: z.coerce.date().optional(),
  buyerNote: z.string().trim().max(500).optional().default(""),
}).strict();

export const createLearningOrderSchema = z.object({
  provider: z.enum(["alipay", "wechat"]).optional(),
}).strict();

export const rejectPaymentEvidenceSchema = z.object({
  reason: z.string().trim().min(2).max(500),
}).strict();

export const cancelLearningOrderSchema = z.object({
  reason: z.string().trim().min(2).max(500),
}).strict();

export const learningOrderIssueInputSchema = z.object({
  type: z.enum(["delivery", "content", "copyright", "payment", "refund", "other"]),
  reason: z.string().trim().min(2).max(200),
  detail: z.string().trim().min(2).max(2000),
}).strict();

export const learningOrderIssueDecisionSchema = z.object({
  action: z.enum(["resolve", "close", "record_refund"]),
  resolution: z.string().trim().min(2).max(2000),
  refundAmountCents: z.number().int().positive().optional(),
  responsibility: z.enum(["buyer", "creator", "platform", "shared", "no_fault"]),
  refundEvidenceUnavailable: z.string().trim().max(1000).optional().default(""),
}).strict().superRefine((input, context) => {
  if (input.action === "record_refund" && !input.refundAmountCents) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["refundAmountCents"],
      message: "记录退款时必须填写退款金额",
    });
  }
  if (input.action !== "record_refund" && input.refundAmountCents !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["refundAmountCents"],
      message: "只有记录退款时可以填写退款金额",
    });
  }
});

export const learningOrderIssueMessageSchema = z.object({
  content: z.string().trim().max(2000).optional().default(""),
  attachmentKind: z.enum(["dispute_attachment", "refund_evidence"]).optional().default("dispute_attachment"),
}).strict();

export const learningMaterialRatingSchema = z.object({
  accuracy: z.number().int().min(1).max(5),
  usefulness: z.number().int().min(1).max(5),
  descriptionMatch: z.number().int().min(1).max(5),
  fileQuality: z.number().int().min(1).max(5),
  content: z.string().trim().max(2000).optional().default(""),
}).strict();

export const learningCreatorViolationSchema = z.object({
  creatorId: z.number().int().positive(),
  itemId: z.number().int().positive().optional(),
  commerceOrderId: z.number().int().positive().optional(),
  type: z.enum(["copyright", "misleading", "file_safety", "delivery", "service", "fraud", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  action: z.enum(["warn", "hide_material", "suspend_7d", "suspend_30d", "revoke"]),
  reason: z.string().trim().min(2).max(1000),
  evidence: z.string().trim().max(3000).optional().default(""),
}).strict().superRefine((input, context) => {
  if (input.action === "hide_material" && !input.itemId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["itemId"],
      message: "隐藏资料时必须关联资料 ID",
    });
  }
});

export const learningCreatorAppealSchema = z.object({
  content: z.string().trim().min(10).max(3000),
}).strict();

export const learningCreatorAppealDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().min(2).max(2000),
}).strict();

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function normalizeIdempotencyKey(value: unknown) {
  const key = String(value ?? "").trim();
  return IDEMPOTENCY_KEY_PATTERN.test(key) ? key : "";
}
