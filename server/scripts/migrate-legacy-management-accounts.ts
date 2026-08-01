import crypto from "node:crypto";
import { prisma } from "../src/prisma";
import { hashPassword } from "../src/utils/password";
import { MANAGEMENT_PERMISSION_CODES, type ManagementPermission } from "../src/services/managementPermissions";

const LOCK_KEY = 1_341_247n * 4_294_967_296n + 11n;
const MOD_PERMISSIONS: ManagementPermission[] = [
  "dashboard.read",
  "users.read",
  "users.moderate",
  "forum.review",
  "forum.moderate",
  "market.review",
  "market.governance",
  "learning.review",
];

async function main() {
  const boss = await prisma.adminAccount.findFirst({
    where: { accountType: "boss", status: "active", mfaEnabled: true },
    select: { id: true, username: true },
  });
  if (!boss) throw new Error("请先使用 manage:bootstrap-boss 创建并启用带 MFA 的唯一 BOSS 账号");

  const legacyUsers = await prisma.user.findMany({
    where: { role: { in: ["admin", "mod"] } },
    orderBy: { id: "asc" },
    select: { id: true, username: true, nickname: true, role: true },
  });
  if (!legacyUsers.length) {
    console.log("没有需要迁移的个人 admin/mod 账号");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
    const rows: Array<{ username: string; managementAccountId: number; created: boolean; status: string }> = [];
    for (const user of legacyUsers) {
      let account = await tx.adminAccount.findUnique({ where: { username: user.username } });
      let created = false;
      if (!account) {
        account = await tx.adminAccount.create({
          data: {
            username: user.username,
            passwordHash: await hashPassword(crypto.randomBytes(48).toString("base64url")),
            displayName: user.nickname || user.username,
            accountType: "admin",
            status: "disabled",
            createdById: boss.id,
          },
        });
        created = true;
      }
      if (account.accountType !== "admin") {
        throw new Error(`个人账号 ${user.username} 与非管理员管理账号重名，无法自动迁移`);
      }
      const recommended = user.role === "admin" ? MANAGEMENT_PERMISSION_CODES : MOD_PERMISSIONS;
      const existing = await tx.adminAccountPermission.findMany({
        where: { adminAccountId: account.id },
        select: { permissionCode: true },
      });
      const union = new Set([...existing.map((row) => row.permissionCode), ...recommended]);
      await tx.adminAccountPermission.createMany({
        data: [...union]
          .filter((permissionCode) => !existing.some((row) => row.permissionCode === permissionCode))
          .map((permissionCode) => ({ adminAccountId: account!.id, permissionCode, grantedById: boss.id })),
        skipDuplicates: true,
      });
      await tx.managementAuditLog.create({
        data: {
          actorId: boss.id,
          action: "management.legacy_account.prepare",
          targetType: "user",
          targetId: String(user.id),
          summary: `为旧个人 ${user.role} 账号准备独立管理账号`,
          detail: JSON.stringify({ username: user.username, managementAccountId: account.id, created, recommended }),
        },
      });
      rows.push({ username: user.username, managementAccountId: account.id, created, status: account.status });
    }
    return rows;
  }, { timeout: 60_000 });

  console.table(result);
  console.log("迁移准备完成。新建账号保持 disabled；请由 BOSS 在 /manage/accounts 重置密码、核对权限并启用，然后运行 manage:cutover-legacy。");
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
