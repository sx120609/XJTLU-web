import crypto from "node:crypto";
import type { Request } from "express";
import { buildRedisKey, incrementRedisKeyWithExpiry } from "./redis";
import { HttpError } from "../utils/response";
import { config } from "../config";

type Phase = "begin" | "submit";

type Bucket = {
  count: number;
  resetAt: number;
};

const RULES = {
  // Shared buckets cannot be bypassed by forging X-Forwarded-For and cap the
  // total traffic sent from this deployment to the school's SSO service.
  beginGlobal: { max: config.xjtluSsoBeginGlobalLimit, windowMs: 5 * 60 * 1000 },
  submitGlobal: { max: config.xjtluSsoSubmitGlobalLimit, windowMs: 10 * 60 * 1000 },
  beginIp: { max: config.xjtluSsoBeginIpLimit, windowMs: 5 * 60 * 1000 },
  submitIp: { max: config.xjtluSsoSubmitIpLimit, windowMs: 10 * 60 * 1000 },
  // Scope account throttling to the request source. A global per-account
  // bucket would let an anonymous attacker lock another user out on demand.
  submitSourceAccount: { max: config.xjtluSsoSubmitAccountLimit, windowMs: 10 * 60 * 1000 },
} as const;

const localBuckets = new Map<string, Bucket>();
const MAX_LOCAL_BUCKETS = 10_000;
const LOCAL_CLEANUP_INTERVAL_MS = 60_000;
let lastLocalCleanupAt = 0;

function cleanupLocalBuckets(now: number) {
  if (now - lastLocalCleanupAt < LOCAL_CLEANUP_INTERVAL_MS) return;
  for (const [key, bucket] of localBuckets) {
    if (bucket.resetAt <= now) localBuckets.delete(key);
  }
  lastLocalCleanupAt = now;
}

async function consume(identity: string, rule: { max: number; windowMs: number }) {
  const digest = crypto.createHash("sha256").update(identity).digest("hex");
  const key = buildRedisKey("rate-limit", "school-auth", digest);
  const sharedCount = await incrementRedisKeyWithExpiry(key, rule.windowMs);
  if (sharedCount !== null) return sharedCount <= rule.max;

  // JavaScript runs these map operations without an await, so they are atomic
  // within one process when Redis is disabled or temporarily unavailable.
  const now = Date.now();
  cleanupLocalBuckets(now);
  let bucket = localBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && localBuckets.size >= MAX_LOCAL_BUCKETS) return false;
    bucket = { count: 0, resetAt: now + rule.windowMs };
  }
  bucket.count += 1;
  localBuckets.set(key, bucket);
  return bucket.count <= rule.max;
}

function requestIp(req: Request) {
  return String(req.ip || req.socket.remoteAddress || "unknown").trim().toLowerCase();
}

export async function enforceSchoolAuthSourceRateLimit(req: Request, phase: Phase) {
  const ip = requestIp(req);
  const ipRule = phase === "begin" ? RULES.beginIp : RULES.submitIp;
  if (!await consume(`${phase}:ip:${ip}`, ipRule)) {
    throw new HttpError(429, 5529, "登录请求过于频繁，请稍后重试");
  }
}

export async function enforceSchoolAuthAccountRateLimit(req: Request, username: string) {
  const ip = requestIp(req);
  const account = String(username ?? "").trim().toLowerCase();
  if (account && !await consume(`submit:source-account:${ip}:${account}`, RULES.submitSourceAccount)) {
    throw new HttpError(429, 5529, "该账号登录尝试过于频繁，请稍后重试");
  }
}

export async function enforceSchoolAuthGlobalRateLimit(phase: Phase) {
  const globalRule = phase === "begin" ? RULES.beginGlobal : RULES.submitGlobal;
  if (!await consume(`${phase}:global`, globalRule)) {
    throw new HttpError(429, 5529, "统一认证服务当前请求较多，请稍后重试");
  }
}

export async function enforceSchoolAuthRateLimit(req: Request, phase: Phase, username?: string) {
  await enforceSchoolAuthSourceRateLimit(req, phase);
  if (phase === "submit") {
    const account = String(username ?? "").trim().toLowerCase();
    if (account) await enforceSchoolAuthAccountRateLimit(req, account);
  }
  await enforceSchoolAuthGlobalRateLimit(phase);
}

export const __schoolAuthRateLimitTesting = {
  localBucketCount: () => localBuckets.size,
  maxLocalBuckets: MAX_LOCAL_BUCKETS,
  resetLocalBuckets: () => {
    localBuckets.clear();
    lastLocalCleanupAt = 0;
  },
};
