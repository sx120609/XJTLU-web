import { prisma } from "../prisma";
import { getSiteConfig, type AnonymousTierConfig } from "./siteSettings";
import { Errors } from "../utils/response";

type TrustUserSnapshot = {
  id?: number;
  reputation?: number | null;
  createdAt: Date | string;
  postCount: number;
  replyCount: number;
  forumEnabled?: boolean | null;
  forumEnabledAt?: Date | string | null;
  anonymousCredits?: number | null;
  anonymousWeekKey?: string | null;
  anonymousCreditsFrozen?: boolean | null;
};

type TrustClient = Pick<typeof prisma, "user">;

type TrustConfig = {
  anonymousMinReputation: number;
  accountAgeDaysPerStep: number;
  accountAgePointsPerStep: number;
  accountAgePointsCap: number;
  postPointsPerTopic: number;
  postPointsCap: number;
  replyPointsPerReply: number;
  replyPointsCap: number;
  forumEnabledBonus: number;
  anonymousTiers: AnonymousTierConfig[];
};

function readTrustConfig(): TrustConfig {
  const config = getSiteConfig();
  return {
    anonymousMinReputation: config.anonymousMinReputation,
    accountAgeDaysPerStep: config.accountAgeDaysPerStep,
    accountAgePointsPerStep: config.accountAgePointsPerStep,
    accountAgePointsCap: config.accountAgePointsCap,
    postPointsPerTopic: config.postPointsPerTopic,
    postPointsCap: config.postPointsCap,
    replyPointsPerReply: config.replyPointsPerReply,
    replyPointsCap: config.replyPointsCap,
    forumEnabledBonus: config.forumEnabledBonus,
    anonymousTiers: config.anonymousTiers,
  };
}

function safeDateValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function accountAgeDays(createdAt: Date | string) {
  const created = safeDateValue(createdAt);
  const diff = Date.now() - created.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function currentIsoWeekParts(date = new Date()) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return {
    year: value.getUTCFullYear(),
    week: weekNo,
  };
}

export function currentAnonymousWeekKey(date = new Date()) {
  const { year, week } = currentIsoWeekParts(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function nextAnonymousResetAt(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const distance = day === 0 ? 1 : 8 - day;
  next.setDate(next.getDate() + distance);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function computeUserReputationBreakdown(
  user: Pick<TrustUserSnapshot, "createdAt" | "postCount" | "replyCount" | "forumEnabled" | "forumEnabledAt">,
  config = readTrustConfig()
) {
  const days = accountAgeDays(user.createdAt);
  const agePoints = Math.min(
    config.accountAgePointsCap,
    Math.floor(days / config.accountAgeDaysPerStep) * config.accountAgePointsPerStep
  );
  const postPoints = Math.min(config.postPointsCap, Math.max(0, user.postCount || 0) * config.postPointsPerTopic);
  const replyPoints = Math.min(config.replyPointsCap, Math.max(0, user.replyCount || 0) * config.replyPointsPerReply);
  const forumPoints = user.forumEnabled || user.forumEnabledAt ? config.forumEnabledBonus : 0;
  const total = agePoints + postPoints + replyPoints + forumPoints;
  return {
    total,
    accountAgeDays: days,
    agePoints,
    postPoints,
    replyPoints,
    forumPoints,
    caps: {
      agePoints: config.accountAgePointsCap,
      postPoints: config.postPointsCap,
      replyPoints: config.replyPointsCap,
    },
  };
}

export function computeAnonymousWeeklyQuota(reputation: number, config = readTrustConfig()) {
  const tiers = [...config.anonymousTiers].sort((a, b) => b.reputation - a.reputation);
  for (const tier of tiers) {
    if (reputation >= tier.reputation) return tier.quota;
  }
  return 0;
}

export function buildUserTrustSnapshot(user: TrustUserSnapshot) {
  const config = readTrustConfig();
  const reputationBreakdown = computeUserReputationBreakdown(user, config);
  const reputation = Math.max(0, Math.min(100, Number(user.reputation ?? 100)));
  const weeklyQuota = 0;
  const currentWeekKey = currentAnonymousWeekKey();

  return {
    reputation,
    reputationBreakdown: {
      ...reputationBreakdown,
      total: reputation,
    },
    anonymousState: {
      eligible: true,
      minReputation: 0,
      weeklyQuota,
      availableCredits: 0,
      storedCredits: 0,
      frozen: false,
      weekKey: currentWeekKey,
      staleWeek: false,
      nextResetAt: nextAnonymousResetAt().toISOString(),
      nextTier: null,
    },
  };
}

export async function refreshAnonymousCreditsIfNeeded(userId: number, client: TrustClient = prisma) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      reputation: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  if (!user) throw Errors.notFound("用户不存在");
  const trust = buildUserTrustSnapshot(user);
  if (!trust.anonymousState.staleWeek) {
    return { user, trust };
  }
  const updated = await client.user.update({
    where: { id: userId },
    data: {
      anonymousWeekKey: trust.anonymousState.weekKey,
      anonymousCredits: trust.anonymousState.frozen ? 0 : trust.anonymousState.weeklyQuota,
    },
    select: {
      id: true,
      reputation: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  return {
    user: updated,
    trust: buildUserTrustSnapshot(updated),
  };
}

export async function consumeAnonymousCredit(userId: number, client: TrustClient = prisma) {
  return refreshAnonymousCreditsIfNeeded(userId, client);
}

export async function freezeAnonymousCredits(userId: number, client: TrustClient = prisma, zeroOut = true) {
  const updated = await client.user.update({
    where: { id: userId },
    data: {
      anonymousCreditsFrozen: true,
      ...(zeroOut ? { anonymousCredits: 0 } : {}),
    },
    select: {
      id: true,
      reputation: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  return {
    user: updated,
    trust: buildUserTrustSnapshot(updated),
  };
}

export function createAnonymousAlias() {
  const seed = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `匿名同学 ${seed}`;
}
