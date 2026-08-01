import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL 未配置，无法演练迁移基线");

const schemaPath = path.resolve(process.cwd(), "prisma", "schema.prisma");
const schemaName = `kaopu_migration_verify_${crypto.randomBytes(6).toString("hex")}`;
assert.match(schemaName, /^kaopu_migration_verify_[a-f0-9]{12}$/);

function databaseUrlForSchema(schema: string) {
  const url = new URL(baseUrl!);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function runPrisma(args: string[], databaseUrl: string) {
  const prismaCli = path.resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} 执行失败`);
}

async function main() {
  const verificationUrl = databaseUrlForSchema(schemaName);
  const verificationClient = new PrismaClient({ datasources: { db: { url: verificationUrl } } });
  const cleanupClient = new PrismaClient({ datasources: { db: { url: databaseUrlForSchema("public") } } });
  const migrationEntries = await readdir(path.resolve(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
  const expectedMigrationCount = migrationEntries.filter((entry) => entry.isDirectory()).length;
  assert.ok(expectedMigrationCount > 0, "迁移目录为空");

  try {
    runPrisma(["migrate", "deploy"], verificationUrl);
    runPrisma(["migrate", "status"], verificationUrl);
    runPrisma([
      "migrate",
      "diff",
      "--from-schema-datasource",
      schemaPath,
      "--to-schema-datamodel",
      schemaPath,
      "--exit-code",
    ], verificationUrl);

    const rows = await verificationClient.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
    `;
    const tables = new Set(rows.map((row) => row.table_name));
    const requiredTables = [
      "User",
      "Board",
      "Topic",
      "TopicFavorite",
      "MarketItem",
      "MarketOrder",
      "TradeIntent",
      "WantedPost",
      "WantedResponse",
      "MarketPreference",
      "MarketMatchNotice",
      "MarketSafetyRule",
      "MarketViolation",
      "MarketAppeal",
      "MarketMessageAttachment",
      "AdminActionLog",
      "LearningMaterialProfile",
      "LearningCommerceOrder",
      "MerchantProfile",
      "PromotionPlan",
      "PromotionOrder",
      "PromotionEvent",
      "_prisma_migrations",
    ];
    for (const table of requiredTables) {
      assert.ok(tables.has(table), `基线缺少数据表：${table}`);
    }
    for (const retiredTable of ["MarketContactCard"]) {
      assert.ok(!tables.has(retiredTable), `已退役数据表仍然存在：${retiredTable}`);
    }

    const migrationCount = await verificationClient.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    assert.equal(
      Number(migrationCount[0]?.count),
      expectedMigrationCount,
      "空库已完成迁移数与活动迁移目录数不一致",
    );
    console.log(`迁移基线空库演练通过：${tables.size} 张表，${expectedMigrationCount} 段迁移。`);
  } finally {
    await verificationClient.$disconnect().catch(() => undefined);
    await cleanupClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await cleanupClient.$disconnect();
    console.log(`已清理临时验证 Schema：${schemaName}`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
