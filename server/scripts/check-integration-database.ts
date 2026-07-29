import dotenv from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function databaseTarget(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname.replace(/^\/+/, "") || "(unknown)",
    };
  } catch {
    return null;
  }
}

async function main() {
  const target = databaseTarget(process.env.DATABASE_URL);
  if (!target) {
    throw new Error("集成测试需要通过环境变量或 server/.env 提供有效的 DATABASE_URL");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!localHosts.has(target.host) && process.env.ALLOW_REMOTE_INTEGRATION_DB !== "true") {
    throw new Error(
      `拒绝在远程数据库 ${target.host}:${target.port}/${target.database} 上运行集成测试；`
      + "如这是隔离的 CI 数据库，请显式设置 ALLOW_REMOTE_INTEGRATION_DB=true",
    );
  }

  const prisma = new PrismaClient({ log: [] });
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    console.log(`集成测试数据库已就绪: ${target.host}:${target.port}/${target.database}`);
  } catch {
    throw new Error(
      `集成测试数据库不可用: ${target.host}:${target.port}/${target.database}；`
      + "请先启动隔离的 PostgreSQL 测试实例并应用迁移",
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
