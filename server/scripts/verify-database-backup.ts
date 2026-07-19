import { stat } from "node:fs/promises";
import { prisma } from "../src/prisma";
import {
  cleanupDatabaseBackupSnapshot,
  createDatabaseBackupSnapshot,
  getDatabaseBackupStatus,
  verifyDatabaseBackupArchive,
} from "../src/services/databaseBackup";

async function main() {
  const status = await getDatabaseBackupStatus();
  if (!status.supported || !status.restoreSupported) {
    throw new Error(status.restoreReason || status.reason || "当前环境不支持数据库备份完整性演练");
  }

  const snapshot = await createDatabaseBackupSnapshot();
  try {
    const file = await stat(snapshot.filePath);
    if (!file.isFile() || file.size <= 0) throw new Error("数据库备份文件为空");
    const verified = await verifyDatabaseBackupArchive(snapshot.filePath);
    console.log(JSON.stringify({
      ok: verified.valid,
      fileSizeBytes: file.size,
      restoreCommand: verified.restoreCommand,
    }));
  } finally {
    await cleanupDatabaseBackupSnapshot(snapshot);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
