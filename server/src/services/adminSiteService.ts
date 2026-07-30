import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { queryPage, querySize } from "../utils/query";
import { Errors } from "../utils/response";
import { runWithDistributedLock } from "./cache";
import { invalidateSiteSettingCaches } from "./cacheInvalidation";
import { backfillForumImageAssetsAndTriggerModeration } from "./imageModeration";
import {
  getFeatures,
  getSiteConfig,
  getSitePromptDefaults,
  setAiReviewConfig,
  setCommunityTrustConfig,
  setFeatures,
  setSiteIdentityConfig,
} from "./siteSettings";
import { backfillForumVideoAssetsAndTriggerModeration } from "./videoModeration";

const FEATURE_KEYS = [
  "forum",
  "market",
  "coursereview",
  "electric",
  "sponsor",
  "promotion",
] as const;
const AI_REVIEW_KINDS = [
  "topic",
  "reply",
  "topic-edit",
  "image",
  "video",
] as const;
const AI_REVIEW_STATUSES = ["started", "success", "error"] as const;

export type AdminSiteActor = {
  userId: number;
  role: string;
};

function requireAdmin(actor: AdminSiteActor) {
  if (actor.role !== "admin") {
    throw Errors.forbidden("仅超级管理员可操作");
  }
}

const serviceUrlSchema = z.string().trim().max(240).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}, "API 地址必须是无凭据的 HTTP(S) 地址");

const anonymousTierSchema = z.object({
  reputation: z.number().int().min(0).max(9999),
  quota: z.number().int().min(0).max(999),
}).strict();

export const adminSiteConfigPatchSchema = z.object({
  siteName: z.string().trim().max(40).optional(),
  siteSubtitle: z.string().trim().max(80).optional(),
  siteLogoUrl: z.string().trim().max(2048).optional(),
  siteOrigin: z.string().trim().max(240).optional(),
  siteFilingNumber: z.string().trim().max(120).optional(),
  aiReviewEnabled: z.boolean().optional(),
  aiReviewProvider: z.string().trim().min(1).max(40).optional(),
  aiReviewApiUrl: serviceUrlSchema.optional(),
  aiReviewModel: z.string().trim().min(1).max(80).optional(),
  aiReviewFallbackModels: z.string().trim().max(400).optional(),
  aiReviewApiKey: z.string().trim().min(1).max(240).optional(),
  clearAiReviewApiKey: z.boolean().optional(),
  imageReviewEnabled: z.boolean().optional(),
  imageReviewApiUrl: serviceUrlSchema.optional(),
  imageReviewModel: z.string().trim().min(1).max(80).optional(),
  imageReviewFallbackModels: z.string().trim().max(400).optional(),
  imageReviewApiKey: z.string().trim().min(1).max(240).optional(),
  clearImageReviewApiKey: z.boolean().optional(),
  imageReviewSystemPrompt: z.string().max(8000).optional(),
  imageReviewUserPrompt: z.string().max(12000).optional(),
  imageReviewConcurrency: z.number().int().min(1).max(8).optional(),
  imageReviewRequestGroupSize: z.number().int().min(1).max(6).optional(),
  videoReviewEnabled: z.boolean().optional(),
  videoReviewApiUrl: serviceUrlSchema.optional(),
  videoReviewModel: z.string().trim().min(1).max(80).optional(),
  videoReviewFallbackModels: z.string().trim().max(400).optional(),
  videoReviewApiKey: z.string().trim().min(1).max(240).optional(),
  clearVideoReviewApiKey: z.boolean().optional(),
  videoReviewSystemPrompt: z.string().max(8000).optional(),
  videoReviewUserPrompt: z.string().max(12000).optional(),
  videoReviewConcurrency: z.number().int().min(1).max(2).optional(),
  aiReviewThreshold: z.number().int().min(0).max(100).optional(),
  imageReviewThreshold: z.number().int().min(0).max(100).optional(),
  videoReviewThreshold: z.number().int().min(0).max(100).optional(),
  aiEditSimilarityThreshold: z.number().min(0).max(1).optional(),
  aiTopicReviewSystemPrompt: z.string().max(8000).optional(),
  aiTopicReviewUserPrompt: z.string().max(12000).optional(),
  aiReplyReviewSystemPrompt: z.string().max(8000).optional(),
  aiReplyReviewUserPrompt: z.string().max(12000).optional(),
  aiEditSimilaritySystemPrompt: z.string().max(8000).optional(),
  aiEditSimilarityUserPrompt: z.string().max(12000).optional(),
  anonymousMinReputation: z.number().int().min(0).max(9999).optional(),
  accountAgeDaysPerStep: z.number().int().min(1).max(3650).optional(),
  accountAgePointsPerStep: z.number().int().min(0).max(999).optional(),
  accountAgePointsCap: z.number().int().min(0).max(9999).optional(),
  postPointsPerTopic: z.number().int().min(0).max(999).optional(),
  postPointsCap: z.number().int().min(0).max(9999).optional(),
  replyPointsPerReply: z.number().int().min(0).max(999).optional(),
  replyPointsCap: z.number().int().min(0).max(9999).optional(),
  forumEnabledBonus: z.number().int().min(0).max(9999).optional(),
  anonymousTiers: z.array(anonymousTierSchema).length(4).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个修改字段",
).superRefine((value, context) => {
  const secretPairs = [
    ["aiReviewApiKey", "clearAiReviewApiKey"],
    ["imageReviewApiKey", "clearImageReviewApiKey"],
    ["videoReviewApiKey", "clearVideoReviewApiKey"],
  ] as const;
  for (const [secret, clear] of secretPairs) {
    if (value[secret] && value[clear]) {
      context.addIssue({
        code: "custom",
        path: [clear],
        message: "不能同时设置并清空同一 API Key",
      });
    }
  }
  if (value.anonymousTiers) {
    for (let index = 1; index < value.anonymousTiers.length; index += 1) {
      const previous = value.anonymousTiers[index - 1];
      const current = value.anonymousTiers[index];
      if (
        current.reputation <= previous.reputation
        || current.quota < previous.quota
      ) {
        context.addIssue({
          code: "custom",
          path: ["anonymousTiers", index],
          message: "匿名档位的信誉门槛必须递增，额度不能下降",
        });
      }
    }
  }
});

export const adminFeaturePatchSchema = z.object({
  forum: z.boolean().optional(),
  market: z.boolean().optional(),
  coursereview: z.boolean().optional(),
  electric: z.boolean().optional(),
  sponsor: z.boolean().optional(),
  promotion: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要提供一个功能开关",
);

export const adminAiReviewLogQuerySchema = z.object({
  kind: z.enum(AI_REVIEW_KINDS).optional(),
  status: z.enum(AI_REVIEW_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  size: z.coerce.number().int().min(10).max(100).optional(),
}).strict();

export type AdminSiteConfigPatch = z.infer<
  typeof adminSiteConfigPatchSchema
>;
export type AdminFeaturePatch = z.infer<typeof adminFeaturePatchSchema>;
export type AdminAiReviewLogQuery = z.infer<
  typeof adminAiReviewLogQuerySchema
>;

const identityKeys = new Set([
  "siteName",
  "siteSubtitle",
  "siteLogoUrl",
  "siteOrigin",
  "siteFilingNumber",
]);
const trustKeys = new Set([
  "anonymousMinReputation",
  "accountAgeDaysPerStep",
  "accountAgePointsPerStep",
  "accountAgePointsCap",
  "postPointsPerTopic",
  "postPointsCap",
  "replyPointsPerReply",
  "replyPointsCap",
  "forumEnabledBonus",
  "anonymousTiers",
]);

function siteConfigDomain(patch: AdminSiteConfigPatch) {
  const keys = Object.keys(patch);
  const domains = new Set(
    keys.map((key) => (
      identityKeys.has(key)
        ? "identity"
        : trustKeys.has(key)
          ? "trust"
          : "ai"
    )),
  );
  if (domains.size !== 1) {
    throw Errors.badRequest(
      "站点身份、AI 审核和信誉规则请分别保存，避免跨域部分更新",
    );
  }
  return [...domains][0] as "identity" | "trust" | "ai";
}

function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}****${secret.slice(-2)}`;
  }
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

export function serializeAdminSiteConfig() {
  const config = getSiteConfig();
  return {
    ...config,
    aiReviewApiKey: "",
    imageReviewApiKey: "",
    videoReviewApiKey: "",
    hasAiReviewApiKey: Boolean(config.aiReviewApiKey),
    aiReviewApiKeyMasked: maskSecret(config.aiReviewApiKey),
    hasImageReviewApiKey: Boolean(config.imageReviewApiKey),
    imageReviewApiKeyMasked: maskSecret(config.imageReviewApiKey),
    hasVideoReviewApiKey: Boolean(config.videoReviewApiKey),
    videoReviewApiKeyMasked: maskSecret(config.videoReviewApiKey),
  };
}

async function withSiteConfigLock<T>(task: () => Promise<T>) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const locked = await runWithDistributedLock(
      "admin-site-config:update",
      30_000,
      task,
    );
    if (locked.acquired) return locked.result;
    await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }
  throw Errors.conflict("站点配置正在被其他管理员修改，请稍后重试");
}

function assertAiProviderReady(
  name: string,
  enabled: boolean,
  endpoint: string,
  model: string,
  apiKey: string,
) {
  if (!enabled) return;
  if (!endpoint || !model || !apiKey) {
    throw Errors.badRequest(
      `启用${name}前请完整配置 API 地址、模型和 API Key`,
    );
  }
}

async function updateAiConfig(patch: AdminSiteConfigPatch) {
  const current = getSiteConfig();
  const aiReviewApiKey = patch.clearAiReviewApiKey
    ? ""
    : (patch.aiReviewApiKey ?? current.aiReviewApiKey);
  const imageReviewApiKey = patch.clearImageReviewApiKey
    ? ""
    : (patch.imageReviewApiKey ?? current.imageReviewApiKey);
  const videoReviewApiKey = patch.clearVideoReviewApiKey
    ? ""
    : (patch.videoReviewApiKey ?? current.videoReviewApiKey);
  assertAiProviderReady(
    "文字审核",
    patch.aiReviewEnabled ?? current.aiReviewEnabled,
    patch.aiReviewApiUrl ?? current.aiReviewApiUrl,
    patch.aiReviewModel ?? current.aiReviewModel,
    aiReviewApiKey,
  );
  assertAiProviderReady(
    "图片审核",
    patch.imageReviewEnabled ?? current.imageReviewEnabled,
    patch.imageReviewApiUrl ?? current.imageReviewApiUrl,
    patch.imageReviewModel ?? current.imageReviewModel,
    imageReviewApiKey,
  );
  assertAiProviderReady(
    "视频审核",
    patch.videoReviewEnabled ?? current.videoReviewEnabled,
    patch.videoReviewApiUrl ?? current.videoReviewApiUrl,
    patch.videoReviewModel ?? current.videoReviewModel,
    videoReviewApiKey,
  );
  const {
    clearAiReviewApiKey: _clearAi,
    clearImageReviewApiKey: _clearImage,
    clearVideoReviewApiKey: _clearVideo,
    ...configPatch
  } = patch;
  return setAiReviewConfig({
    ...configPatch,
    aiReviewApiKey,
    imageReviewApiKey,
    videoReviewApiKey,
  });
}

export function getAdminSiteConfig(actor: AdminSiteActor) {
  requireAdmin(actor);
  return serializeAdminSiteConfig();
}

export function getAdminSitePromptDefaults(actor: AdminSiteActor) {
  requireAdmin(actor);
  return getSitePromptDefaults();
}

export async function updateAdminSiteConfig(
  actor: AdminSiteActor,
  patch: AdminSiteConfigPatch,
) {
  requireAdmin(actor);
  const domain = siteConfigDomain(patch);
  try {
    await withSiteConfigLock(async () => {
      if (domain === "identity") {
        await setSiteIdentityConfig(patch);
      } else if (domain === "trust") {
        await setCommunityTrustConfig(patch);
      } else {
        await updateAiConfig(patch);
      }
      await invalidateSiteSettingCaches();
    });
    return serializeAdminSiteConfig();
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "status" in error
    ) {
      throw error;
    }
    throw Errors.badRequest(
      error instanceof Error ? error.message : "站点配置不正确",
    );
  }
}

export function getAdminFeatures(actor: AdminSiteActor) {
  requireAdmin(actor);
  return getFeatures();
}

export async function updateAdminFeatures(
  actor: AdminSiteActor,
  patch: AdminFeaturePatch,
) {
  requireAdmin(actor);
  await withSiteConfigLock(async () => {
    await setFeatures(patch);
    await invalidateSiteSettingCaches();
  });
  return getFeatures();
}

export async function listAdminAiReviewLogs(
  actor: AdminSiteActor,
  query: AdminAiReviewLogQuery,
) {
  requireAdmin(actor);
  const staleStartedBefore = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.aiReviewLog.updateMany({
    where: {
      status: "started",
      startedAt: { lt: staleStartedBefore },
    },
    data: {
      status: "error",
      errorMessage: "AI 审核请求中断或服务重启，未收到接口返回",
      finishedAt: new Date(),
    },
  }).catch(() => null);
  const page = queryPage(query.page);
  const size = querySize(query.size, 30, 10, 100);
  const where: Prisma.AiReviewLogWhereInput = {};
  if (query.kind) where.kind = query.kind;
  if (query.status) where.status = query.status;
  const [list, total] = await Promise.all([
    prisma.aiReviewLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * size,
      take: size,
      include: {
        createdBy: {
          select: { id: true, nickname: true, username: true },
        },
      },
    }),
    prisma.aiReviewLog.count({ where }),
  ]);
  return { page, size, total, list };
}

async function runSweep<T>(
  name: string,
  task: () => Promise<T>,
) {
  const locked = await runWithDistributedLock(name, 15 * 60_000, task);
  if (!locked.acquired) {
    throw Errors.conflict("全站媒体补扫任务正在运行");
  }
  return locked.result;
}

export async function sweepAdminForumImages(actor: AdminSiteActor) {
  requireAdmin(actor);
  return runSweep(
    "admin-forum-image-backfill",
    backfillForumImageAssetsAndTriggerModeration,
  );
}

export async function sweepAdminForumVideos(actor: AdminSiteActor) {
  requireAdmin(actor);
  return runSweep(
    "admin-forum-video-backfill",
    backfillForumVideoAssetsAndTriggerModeration,
  );
}

export const ADMIN_FEATURE_KEYS = FEATURE_KEYS;
