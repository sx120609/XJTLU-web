import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { hashPassword } from "../utils/password";
import { revokeAllManagementSessions } from "./managementAuthService";
import type { ManagementPrincipal } from "./managementAuthService";
import {
  BOSS_ONLY_PERMISSION_CODES,
  MANAGEMENT_PERMISSION_CATALOG,
  isKnownManagementPermission,
  type ManagementPermission,
} from "./managementPermissions";

export const managementAccountCreateSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_]+$/),
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(1).max(80),
}).strict();

export const managementAccountPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["active", "disabled", "locked"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少需要提供一个修改字段");

export const managementAccountPasswordSchema = z.object({
  newPassword: z.string().min(12).max(128),
}).strict();

export const managementAccountPermissionSchema = z.object({
  permissions: z.array(z.string()).max(64),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const permission of value.permissions) {
    if (seen.has(permission)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["permissions"], message: `重复权限：${permission}` });
    }
    seen.add(permission);
    if (!isKnownManagementPermission(permission)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["permissions"], message: `未知或不可分配权限：${permission}` });
    }
  }
});

export type ManagementAccountCreate = z.infer<typeof managementAccountCreateSchema>;
export type ManagementAccountPatch = z.infer<typeof managementAccountPatchSchema>;
export type ManagementAccountPermissionInput = z.infer<typeof managementAccountPermissionSchema>;

function requireBoss(actor: ManagementPrincipal) {
  if (actor.accountType !== "boss") throw Errors.forbidden("仅 BOSS 可以管理管理员账号和权限");
}

function serializeDetail(value: unknown) {
  try { return JSON.stringify(value ?? {}); } catch { return "{}"; }
}

async function audit(
  actor: ManagementPrincipal,
  action: string,
  targetType: string,
  targetId: string | number,
  summary: string,
  detail: unknown,
  ip = "",
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  await tx.managementAuditLog.create({
    data: {
      actorId: actor.adminAccountId,
      action,
      targetType,
      targetId: String(targetId),
      summary,
      detail: serializeDetail(detail),
      ip: ip.slice(0, 128),
    },
  });
}

export async function recordManagementAudit(
  actor: ManagementPrincipal,
  action: string,
  targetType: string,
  targetId: string | number,
  summary: string,
  detail: unknown,
  ip = "",
) {
  await audit(actor, action, targetType, targetId, summary, detail, ip);
}

async function targetAdmin(id: number) {
  const target = await prisma.adminAccount.findUnique({
    where: { id },
    select: { id: true, username: true, displayName: true, accountType: true, status: true },
  });
  if (!target) throw Errors.notFound("管理账号不存在");
  if (target.accountType !== "admin") throw Errors.forbidden("BOSS 账号受保护，不能通过管理员接口操作");
  return target;
}

export function managementPermissionCatalog() {
  return {
    permissions: Object.entries(MANAGEMENT_PERMISSION_CATALOG).map(([code, definition]) => ({ code, ...definition })),
    bossOnly: [...BOSS_ONLY_PERMISSION_CODES],
  };
}

export async function listManagementAccounts(actor: ManagementPrincipal) {
  requireBoss(actor);
  const accounts = await prisma.adminAccount.findMany({
    orderBy: [{ accountType: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      username: true,
      displayName: true,
      accountType: true,
      status: true,
      mfaEnabled: true,
      permissionVersion: true,
      lastLoginAt: true,
      lastLoginIp: true,
      createdById: true,
      createdAt: true,
      permissions: { select: { permissionCode: true }, orderBy: { permissionCode: "asc" } },
      createdBy: { select: { id: true, username: true, displayName: true } },
    },
  });
  return accounts.map((account) => ({
    ...account,
    permissions: account.permissions.map((row) => row.permissionCode),
  }));
}

export async function createManagementAdmin(
  actor: ManagementPrincipal,
  input: ManagementAccountCreate,
  ip = "",
) {
  requireBoss(actor);
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.adminAccount.create({
        data: {
          username: input.username,
          passwordHash,
          displayName: input.displayName,
          accountType: "admin",
          status: "active",
          createdById: actor.adminAccountId,
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          accountType: true,
          status: true,
          mfaEnabled: true,
          permissionVersion: true,
          createdAt: true,
        },
      });
      await audit(actor, "management.account.create", "admin_account", account.id, `创建管理员 ${account.username}`, {
        username: account.username,
        displayName: account.displayName,
      }, ip, tx);
      return { ...account, permissions: [] as string[] };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && String((error as { code?: string }).code) === "P2002") {
      throw Errors.conflict("管理账号用户名已被占用");
    }
    throw error;
  }
}

export async function updateManagementAdmin(
  actor: ManagementPrincipal,
  id: number,
  patch: ManagementAccountPatch,
  ip = "",
) {
  requireBoss(actor);
  const target = await targetAdmin(id);
  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.adminAccount.update({
      where: { id: target.id },
      data: patch,
      select: {
        id: true,
        username: true,
        displayName: true,
        accountType: true,
        status: true,
        mfaEnabled: true,
        permissionVersion: true,
        createdAt: true,
      },
    });
    await audit(actor, "management.account.update", "admin_account", account.id, `更新管理员 ${account.username}`, patch, ip, tx);
    return account;
  });
  if (patch.status && patch.status !== "active") await revokeAllManagementSessions(target.id);
  return result;
}

export async function resetManagementAdminPassword(
  actor: ManagementPrincipal,
  id: number,
  newPassword: string,
  ip = "",
) {
  requireBoss(actor);
  const target = await targetAdmin(id);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.adminAccount.update({ where: { id: target.id }, data: { passwordHash } });
    await audit(actor, "management.account.password_reset", "admin_account", target.id, `重置管理员 ${target.username} 密码`, {}, ip, tx);
  });
  const revoked = await revokeAllManagementSessions(target.id);
  return { ok: true as const, revokedSessions: revoked };
}

export async function replaceManagementAdminPermissions(
  actor: ManagementPrincipal,
  id: number,
  input: ManagementAccountPermissionInput,
  ip = "",
) {
  requireBoss(actor);
  const target = await targetAdmin(id);
  const permissions = [...new Set(input.permissions)] as ManagementPermission[];
  if (permissions.some((permission) => !isKnownManagementPermission(permission))) {
    throw Errors.badRequest("包含未知或不可分配权限");
  }
  const result = await prisma.$transaction(async (tx) => {
    await tx.adminAccountPermission.deleteMany({ where: { adminAccountId: target.id } });
    if (permissions.length) {
      await tx.adminAccountPermission.createMany({
        data: permissions.map((permissionCode) => ({
          adminAccountId: target.id,
          permissionCode,
          grantedById: actor.adminAccountId,
        })),
      });
    }
    const account = await tx.adminAccount.update({
      where: { id: target.id },
      data: { permissionVersion: { increment: 1 } },
      select: { id: true, username: true, permissionVersion: true },
    });
    await audit(actor, "management.account.permissions_replace", "admin_account", target.id, `更新管理员 ${target.username} 权限`, { permissions }, ip, tx);
    return account;
  });
  const revoked = await revokeAllManagementSessions(target.id);
  return { ...result, permissions, revokedSessions: revoked };
}

export async function revokeManagementAdminSessions(actor: ManagementPrincipal, id: number, ip = "") {
  requireBoss(actor);
  const target = await targetAdmin(id);
  const revoked = await revokeAllManagementSessions(target.id);
  await audit(actor, "management.account.sessions_revoke", "admin_account", target.id, `撤销管理员 ${target.username} 的全部会话`, { revoked }, ip);
  return { ok: true as const, revokedSessions: revoked };
}

export async function listManagementAuditLogs(actor: ManagementPrincipal, page: number, size: number) {
  const [total, list] = await Promise.all([
    prisma.managementAuditLog.count(),
    prisma.managementAuditLog.findMany({
      include: { actor: { select: { id: true, username: true, displayName: true, accountType: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * size,
      take: size,
    }),
  ]);
  return { page, size, total, list };
}
