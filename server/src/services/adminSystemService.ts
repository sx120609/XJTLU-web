import { z } from "zod";
import { config } from "../config";
import { getHttpPerformanceSnapshot } from "../middleware/requestObservability";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { getCacheMetricsSnapshot } from "./cache";
import {
  generateJwxtAgentToken,
  getJwxtAgentConfigSource,
  getJwxtAgentRuntimeConfig,
  updateJwxtAgentRuntimeConfig,
} from "./jwxtAgentConfig";
import { getJwxtAgentState } from "./jwxtAgentGateway";
import { getQueryAgentPoolSnapshot } from "./jwxtAgentRemote";
import { getRuntimeHealthSnapshot } from "./runtimeHealth";
import { getSsoLoginPoolSnapshot } from "./ssoLoginPool";

export const adminJwxtAgentConfigSchema = z.object({
  localJwxtEnabled: z.boolean(),
  localJwxtWeight: z.number().int().min(1).max(100),
  crawlAgentId: z.string().trim().max(64),
  agents: z.array(z.object({
    id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    name: z.string().trim().min(1).max(80),
    token: z.string().trim().min(32).max(512).optional(),
    enabled: z.boolean(),
    jwxtEnabled: z.boolean(),
    crawlEnabled: z.boolean(),
    weight: z.number().int().min(1).max(100),
    maxConcurrent: z.number().int().min(1).max(100),
  }).strict()).max(100),
}).strict();

export type AdminJwxtAgentConfig = z.infer<typeof adminJwxtAgentConfigSchema>;

function requireAdmin(role: string) {
  if (role !== "admin") throw Errors.forbidden("仅超级管理员可操作");
}

export function getAdminJwxtAgentSnapshot(role: string) {
  requireAdmin(role);
  const runtime = getJwxtAgentRuntimeConfig();
  const queryPoolById = new Map(
    getQueryAgentPoolSnapshot().map((item) => [item.id, item]),
  );
  const loginPool = getSsoLoginPoolSnapshot();
  const loginPoolById = new Map(
    loginPool.nodes.map((item) => [item.id, item]),
  );
  return {
    source: getJwxtAgentConfigSource(),
    agentPath: config.jwxtAgentPath,
    localJwxtEnabled: runtime.localJwxtEnabled,
    localJwxtWeight: runtime.localJwxtWeight,
    crawlAgentId: runtime.crawlAgentId,
    local: queryPoolById.get("local") ?? null,
    localLoginPool: loginPoolById.get("local") ?? null,
    loginPool: {
      dedicated: loginPool.dedicated,
      queryTransport: loginPool.queryTransport,
    },
    agents: runtime.agents.map(({ token: _token, ...agent }) => ({
      ...agent,
      tokenConfigured: true,
      connection: getJwxtAgentState(agent.id),
      pool: queryPoolById.get(agent.id) ?? null,
      loginPool: loginPoolById.get(agent.id) ?? null,
    })),
  };
}

export async function updateAdminJwxtAgents(
  role: string,
  input: AdminJwxtAgentConfig,
) {
  requireAdmin(role);
  try {
    await updateJwxtAgentRuntimeConfig(input);
  } catch (error) {
    throw Errors.badRequest(
      error instanceof Error ? error.message : "教务 Agent 配置无效",
    );
  }
  return getAdminJwxtAgentSnapshot(role);
}

export function issueAdminJwxtAgentToken(role: string) {
  requireAdmin(role);
  return { token: generateJwxtAgentToken() };
}

export async function getAdminSystemHealth(role: string) {
  requireAdmin(role);
  const startedAt = Date.now();
  let databaseOk = false;
  let databaseError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1 AS "ok"`;
    databaseOk = true;
  } catch (error) {
    databaseError = error instanceof Error
      ? error.message.replace(/\s+/g, " ").slice(0, 200)
      : "数据库探测失败";
  }
  return {
    generatedAt: new Date().toISOString(),
    database: {
      ok: databaseOk,
      latencyMs: Date.now() - startedAt,
      error: databaseError,
    },
    cache: getCacheMetricsSnapshot(),
    http: getHttpPerformanceSnapshot(),
    ...getRuntimeHealthSnapshot(),
  };
}
