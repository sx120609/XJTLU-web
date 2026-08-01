import crypto from "node:crypto";
import type { Request } from "express";
import { config } from "../config";
import { HttpError } from "../utils/response";
import { buildRedisKey, incrementRedisKeyWithExpiry } from "./redis";

type Bucket = { count: number; resetAt: number };
const WINDOW_MS = 15 * 60 * 1000;
const MAX_LOCAL_BUCKETS = 10_000;
const localBuckets = new Map<string, Bucket>();
let lastCleanupAt = 0;

function cleanup(now: number) {
  if (now - lastCleanupAt < 60_000) return;
  for (const [key, bucket] of localBuckets) {
    if (bucket.resetAt <= now) localBuckets.delete(key);
  }
  lastCleanupAt = now;
}

async function consume(identity: string, max: number) {
  const digest = crypto.createHash("sha256").update(identity).digest("hex");
  const key = buildRedisKey("rate-limit", "management-login", digest);
  const sharedCount = await incrementRedisKeyWithExpiry(key, WINDOW_MS);
  if (sharedCount !== null) return sharedCount <= max;

  const now = Date.now();
  cleanup(now);
  let bucket = localBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && localBuckets.size >= MAX_LOCAL_BUCKETS) return false;
    bucket = { count: 0, resetAt: now + WINDOW_MS };
  }
  bucket.count += 1;
  localBuckets.set(key, bucket);
  return bucket.count <= max;
}

function source(req: Request) {
  return String(req.ip || req.socket.remoteAddress || "unknown").trim().toLowerCase();
}

export async function enforceManagementLoginRateLimit(req: Request, username: string) {
  const ip = source(req);
  const account = String(username || "").trim().toLowerCase();
  const allowedIp = await consume(`ip:${ip}`, config.managementLoginIpLimit);
  if (!allowedIp) throw new HttpError(429, 5629, "管理登录尝试过于频繁，请稍后重试");
  if (account) {
    const allowedAccount = await consume(
      `source-account:${ip}:${account}`,
      config.managementLoginSourceAccountLimit,
    );
    if (!allowedAccount) throw new HttpError(429, 5629, "该管理账号登录尝试过于频繁，请稍后重试");
  }
  const allowedGlobal = await consume("global", config.managementLoginGlobalLimit);
  if (!allowedGlobal) throw new HttpError(429, 5629, "管理登录服务当前请求较多，请稍后重试");
}

export const __managementLoginRateLimitTesting = {
  reset() { localBuckets.clear(); lastCleanupAt = 0; },
  bucketCount() { return localBuckets.size; },
  maxLocalBuckets: MAX_LOCAL_BUCKETS,
};
