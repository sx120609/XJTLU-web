import { prisma } from "../src/prisma";

const LOCK_KEY = 1_341_247n * 4_294_967_296n + 12n;

async function main() {
  if (process.env.LEGACY_ADMIN_CUTOVER !== "yes") {
    throw new Error("安全保护：确认切换时请显式设置 LEGACY_ADMIN_CUTOVER=yes");
  }
  const boss = await prisma.adminAccount.findFirst({
    where: { accountType: "boss", status: "active", mfaEnabled: true },
    select: { id: true },
  });
  if (!boss) throw new Error("不存在可用的 MFA BOSS 账号，禁止切换");

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
    const legacyUsers = await tx.user.findMany({
      where: { role: { in: ["admin", "mod"] } },
      orderBy: { id: "asc" },
      select: { id: true, username: true, role: true },
    });
    const blockers: string[] = [];
    for (const user of legacyUsers) {
      const account = await tx.adminAccount.findUnique({
        where: { username: user.username },
        include: { permissions: { select: { id: true } } },
      });
      if (!account || account.accountType !== "admin" || account.status !== "active" || !account.permissions.length) {
        blockers.push(`${user.username}：独立管理账号不存在、未启用或未分配权限`);
      }
    }
    if (blockers.length) throw new Error(`仍有账号未完成迁移：\n${blockers.join("\n")}`);

    for (const user of legacyUsers) {
      await tx.user.update({ where: { id: user.id }, data: { role: "user" } });
      await tx.managementAuditLog.create({
        data: {
          actorId: boss.id,
          action: "management.legacy_account.cutover",
          targetType: "user",
          targetId: String(user.id),
          summary: "移除个人账号的旧后台角色",
          detail: JSON.stringify({ username: user.username, previousRole: user.role, nextRole: "user" }),
        },
      });
    }
    return legacyUsers;
  }, { timeout: 60_000 });

  console.table(result.map((row) => ({ username: row.username, previousRole: row.role, nextRole: "user" })));
  console.log("旧个人 admin/mod 身份切换完成；后续后台操作必须使用 /manage 独立管理登录。");
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
