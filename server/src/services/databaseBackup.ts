import { spawn } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { prisma } from "../prisma";
import { loadFeatures } from "./siteSettings";
import { loadStorageConfig } from "./storageConfig";
import {
  beginDatabaseMaintenance,
  endDatabaseMaintenance,
  getDatabaseMaintenanceMessage,
  isDatabaseMaintenanceActive,
} from "./maintenance";

function postgresCommandCandidates(
  executable: "pg_dump" | "pg_restore",
  configuredCommand: string | undefined,
) {
  const candidates: string[] = [];
  if (configuredCommand?.trim()) candidates.push(configuredCommand.trim());

  const root = process.platform === "win32"
    ? path.join(String(process.env.LOCALAPPDATA || "").trim(), "XJTLU-web")
    : "/usr/lib/postgresql";
  try {
    const directories = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (
        process.platform === "win32" ? /^postgresql-/i.test(entry.name) : /^\d+(?:\.\d+)*$/.test(entry.name)
      ))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const directory of directories) {
      const command = process.platform === "win32"
        ? path.join(root, directory, "pgsql", "bin", `${executable}.exe`)
        : path.join(root, directory, "bin", executable);
      if (existsSync(command)) candidates.push(command);
    }
  } catch {
    // Fall back to PATH when no versioned PostgreSQL client directory exists.
  }
  candidates.push(executable);
  return [...new Set(candidates)];
}

const PG_DUMP_COMMANDS = postgresCommandCandidates("pg_dump", process.env.PG_DUMP_BIN);
const PG_RESTORE_COMMANDS = postgresCommandCandidates("pg_restore", process.env.PG_RESTORE_BIN);
const DATABASE_RESTORE_UPLOAD_ACCEPT = ".dump,.backup,.tar";
const DATABASE_RESTORE_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

export type DatabaseBackupStatus = {
  supported: boolean;
  provider: "postgresql" | "unsupported";
  backupMethod: "pg-dump" | null;
  restoreSupported: boolean;
  restoreMethod: "pg-restore" | null;
  exists: boolean;
  maintenanceActive: boolean;
  maintenanceMessage: string;
  databasePathLabel: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  downloadFileName: string | null;
  reason: string | null;
  restoreReason: string | null;
  maxRestoreUploadBytes: number | null;
  restoreUploadAccept: string;
};

export type DatabaseRestoreResult = {
  restoredAt: string;
  durationMs: number;
  fileName: string;
  fileSizeBytes: number;
  provider: "postgresql";
};

export type DatabaseRestoreFailureCode = "invalid-backup" | "restore-failed" | "database-unavailable";

export class DatabaseRestoreFailure extends Error {
  constructor(public readonly failureCode: DatabaseRestoreFailureCode, message: string) {
    super(message);
    this.name = "DatabaseRestoreFailure";
  }
}

function databaseUrl() {
  return String(process.env.DATABASE_URL ?? "").trim().replace(/^"(.*)"$/, "$1");
}

function detectProvider(raw = databaseUrl()) {
  if (/^postgres(ql)?:\/\//i.test(raw)) return "postgresql" as const;
  return "unsupported" as const;
}

function parsePostgresUrl(raw: string) {
  const parsed = new URL(raw);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database: parsed.pathname.replace(/^\/+/, ""),
    sslmode: parsed.searchParams.get("sslmode") || "",
  };
}

function displayPostgresLabel(raw: string) {
  try {
    const parsed = parsePostgresUrl(raw);
    const auth = parsed.user ? `${parsed.user}@` : "";
    return `postgresql://${auth}${parsed.host}:${parsed.port}/${parsed.database || "(default)"}`;
  } catch {
    return raw.replace(/:[^:@/]+@/, ":***@");
  }
}

function backupStamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function postgresBackupFileName(date = new Date()) {
  return `xjtlu-web-db-backup-${backupStamp(date)}.dump`;
}

export function databaseRestoreUploadLimitBytes() {
  return DATABASE_RESTORE_UPLOAD_LIMIT_BYTES;
}

async function removeIfExists(filePath: string) {
  await unlink(filePath).catch(() => undefined);
}

function normalizeNumeric(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function commandAvailable(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["--version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

async function postgresDatabaseSize() {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("SELECT pg_database_size(current_database()) AS size_bytes");
  const value = rows[0] ? Object.values(rows[0])[0] : null;
  return normalizeNumeric(value);
}

function buildPostgresCommandContext() {
  const parsed = parsePostgresUrl(databaseUrl());
  const env = {
    ...process.env,
    ...(parsed.password ? { PGPASSWORD: parsed.password } : {}),
    ...(parsed.sslmode ? { PGSSLMODE: parsed.sslmode } : {}),
  };
  const connectionArgs = [
    "--host",
    parsed.host,
    "--port",
    parsed.port,
  ];
  if (parsed.user) connectionArgs.push("--username", parsed.user);
  return {
    parsed,
    env,
    connectionArgs,
  };
}

function summarizeCommandFailure(stderr: string, fallback: string) {
  const normalized = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
    .join("\n")
    .trim();
  return normalized || fallback;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

async function validatePgRestoreArchive(command: string, sourcePath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["--list", sourcePath], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      reject(new DatabaseRestoreFailure(
        "invalid-backup",
        `无法检查备份文件：${errorMessage(error, "pg_restore 无法启动")}`,
      ));
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = summarizeCommandFailure(stderr, `pg_restore 无法读取该文件，退出码 ${code ?? "unknown"}`);
      reject(new DatabaseRestoreFailure("invalid-backup", `备份文件格式无效或版本不兼容：${detail}`));
    });
  });
}

async function firstAvailableCommand(candidates: string[]) {
  for (const command of candidates) {
    if (await commandAvailable(command)) return command;
  }
  return null;
}

async function resolvePgRestoreForArchive(sourcePath: string) {
  let lastValidationError: unknown = null;
  let foundAvailableCommand = false;
  for (const command of PG_RESTORE_COMMANDS) {
    if (!(await commandAvailable(command))) continue;
    foundAvailableCommand = true;
    try {
      await validatePgRestoreArchive(command, sourcePath);
      return command;
    } catch (error) {
      lastValidationError = error;
    }
  }
  if (!foundAvailableCommand) {
    throw new Error("当前环境未找到 pg_restore，无法恢复 PostgreSQL 备份");
  }
  throw lastValidationError;
}

async function runPgDump(command: string, targetPath: string) {
  const { parsed, env, connectionArgs } = buildPostgresCommandContext();
  await new Promise<void>((resolve, reject) => {
    const args = [
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-privileges",
      "--file",
      targetPath,
      ...connectionArgs,
    ];
    args.push(parsed.database);

    const child = spawn(command, args, {
      windowsHide: true,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(summarizeCommandFailure(stderr, `pg_dump 失败，退出码 ${code ?? "unknown"}`)));
    });
  });
}

async function runPgRestore(command: string, sourcePath: string) {
  const { parsed, env, connectionArgs } = buildPostgresCommandContext();
  await new Promise<void>((resolve, reject) => {
    const args = [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--single-transaction",
      ...connectionArgs,
      "--dbname",
      parsed.database,
      sourcePath,
    ];

    const child = spawn(command, args, {
      windowsHide: true,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => reject(new DatabaseRestoreFailure(
      "restore-failed",
      `pg_restore 无法启动：${errorMessage(error, "未知错误")}`,
    )));
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new DatabaseRestoreFailure(
        "restore-failed",
        `PostgreSQL 恢复失败：${summarizeCommandFailure(stderr, `pg_restore 退出码 ${code ?? "unknown"}`)}`,
      ));
    });
  });
}

export async function getDatabaseBackupStatus(): Promise<DatabaseBackupStatus> {
  const provider = detectProvider();
  if (provider !== "postgresql") {
    return {
      supported: false,
      provider: "unsupported",
      backupMethod: null,
      restoreSupported: false,
      restoreMethod: null,
      exists: false,
      maintenanceActive: isDatabaseMaintenanceActive(),
      maintenanceMessage: getDatabaseMaintenanceMessage(),
      databasePathLabel: null,
      sizeBytes: null,
      updatedAt: null,
      downloadFileName: null,
      reason: "当前服务端只支持 PostgreSQL，DATABASE_URL 不是 PostgreSQL 连接串",
      restoreReason: "当前服务端只支持 PostgreSQL，DATABASE_URL 不是 PostgreSQL 连接串",
      maxRestoreUploadBytes: DATABASE_RESTORE_UPLOAD_LIMIT_BYTES,
      restoreUploadAccept: DATABASE_RESTORE_UPLOAD_ACCEPT,
    };
  }

  const raw = databaseUrl();
  const pgDumpCommand = await firstAvailableCommand(PG_DUMP_COMMANDS);
  const pgRestoreCommand = await firstAvailableCommand(PG_RESTORE_COMMANDS);
  const pgDumpReady = Boolean(pgDumpCommand);
  const pgRestoreReady = Boolean(pgRestoreCommand);
  const sizeBytes = await postgresDatabaseSize().catch(() => null);
  return {
    supported: pgDumpReady,
    provider: "postgresql",
    backupMethod: pgDumpReady ? "pg-dump" : null,
    restoreSupported: pgRestoreReady,
    restoreMethod: pgRestoreReady ? "pg-restore" : null,
    exists: true,
    maintenanceActive: isDatabaseMaintenanceActive(),
    maintenanceMessage: getDatabaseMaintenanceMessage(),
    databasePathLabel: displayPostgresLabel(raw),
    sizeBytes,
    updatedAt: null,
    downloadFileName: postgresBackupFileName(),
    reason: pgDumpReady ? null : "当前环境未找到 pg_dump，无法导出 PostgreSQL 备份",
    restoreReason: pgRestoreReady ? null : "当前环境未找到 pg_restore，无法恢复 PostgreSQL 备份",
    maxRestoreUploadBytes: DATABASE_RESTORE_UPLOAD_LIMIT_BYTES,
    restoreUploadAccept: DATABASE_RESTORE_UPLOAD_ACCEPT,
  };
}

export async function createDatabaseBackupSnapshot() {
  if (detectProvider() !== "postgresql") {
    throw new Error("当前服务端只支持 PostgreSQL 在线备份");
  }
  const pgDumpCommand = await firstAvailableCommand(PG_DUMP_COMMANDS);
  if (!pgDumpCommand) throw new Error("当前环境未找到 pg_dump，无法导出 PostgreSQL 备份");

  const tempDir = await mkdtemp(path.join(tmpdir(), "xjtlu-web-db-backup-"));
  const snapshotPath = path.join(tempDir, `postgres-${randomUUID()}.dump`);
  await runPgDump(pgDumpCommand, snapshotPath);
  return {
    filePath: snapshotPath,
    tempDir,
    fileName: postgresBackupFileName(),
    contentType: "application/octet-stream",
  };
}

export async function cleanupDatabaseBackupSnapshot(snapshot: { filePath: string; tempDir: string }) {
  await removeIfExists(snapshot.filePath);
  await rm(snapshot.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function restoreDatabaseBackupSnapshot(input: {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
}): Promise<DatabaseRestoreResult> {
  if (detectProvider() !== "postgresql") {
    throw new Error("当前服务端只支持 PostgreSQL 在线恢复");
  }
  const pgRestoreCommand = await resolvePgRestoreForArchive(input.filePath);
  if (!beginDatabaseMaintenance("数据库恢复中，请稍后再试")) {
    throw new Error("数据库当前正在维护中，请稍后再试");
  }

  const startedAt = Date.now();
  let restoreError: unknown = null;

  try {
    await prisma.$disconnect().catch(() => undefined);
    await runPgRestore(pgRestoreCommand, input.filePath);
  } catch (error) {
    restoreError = error;
  }

  try {
    await prisma.$connect();
    await prisma.$queryRawUnsafe("SELECT 1");
    await Promise.all([
      loadFeatures().catch(() => undefined),
      loadStorageConfig().catch(() => undefined),
    ]);
  } catch (error) {
    if (!restoreError) {
      restoreError = new DatabaseRestoreFailure(
        "database-unavailable",
        `恢复后无法重新连接数据库：${errorMessage(error, "未知错误")}`,
      );
    }
  }

  endDatabaseMaintenance();

  if (restoreError) throw restoreError;

  return {
    restoredAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    provider: "postgresql",
  };
}
