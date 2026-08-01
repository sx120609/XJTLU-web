import crypto from "node:crypto";
import type { Request } from "express";
import { prisma } from "../prisma";
import { config } from "../config";
import { Errors } from "../utils/response";
import { hashPassword, verifyPassword } from "../utils/password";
import { decryptManagementSecret, hashManagementToken } from "../utils/managementCrypto";
import { signManagementToken, verifyManagementToken, type ManagementJwtPayload } from "../utils/managementJwt";
import {
  BOSS_ONLY_PERMISSION_CODES,
  MANAGEMENT_PERMISSION_CODES,
  isBossOnlyPermission,
  isKnownManagementPermission,
  type ManagementPermission,
} from "./managementPermissions";
import { verifyTotp } from "../utils/totp";

export type ManagementPrincipal = {
  adminAccountId: number;
  sessionId: string;
  accountType: "boss" | "admin";
  username: string;
  displayName: string;
  permissionVersion: number;
};

function managementTokenFromRequest(req: Request) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function isAccountType(value: string): value is "boss" | "admin" {
  return value === "boss" || value === "admin";
}

function isActiveSession(session: { revokedAt: Date | null; expiresAt: Date; lastSeenAt: Date }) {
  const now = Date.now();
  return !session.revokedAt
    && session.expiresAt.getTime() > now
    && session.lastSeenAt.getTime() > now - config.managementSessionIdleMs;
}

export async function hydrateManagementPrincipal(token: string): Promise<ManagementPrincipal> {
  let payload: ManagementJwtPayload;
  try {
    payload = verifyManagementToken(token);
  } catch {
    throw Errors.unauthorized("管理登录已过期，请重新登录");
  }
  if (!Number.isInteger(payload.adminAccountId) || !payload.sessionId || !isAccountType(payload.accountType)) {
    throw Errors.unauthorized("管理会话无效，请重新登录");
  }

  const session = await prisma.adminSession.findUnique({
    where: { id: payload.sessionId },
    include: {
      adminAccount: {
        select: {
          id: true,
          username: true,
          displayName: true,
          accountType: true,
          status: true,
          permissionVersion: true,
        },
      },
    },
  });
  if (
    !session
    || session.adminAccountId !== payload.adminAccountId
    || session.tokenHash !== hashManagementToken(token)
    || !isActiveSession(session)
  ) {
    throw Errors.unauthorized("管理会话已失效，请重新登录");
  }
  const account = session.adminAccount;
  if (
    account.status !== "active"
    || !isAccountType(account.accountType)
    || account.accountType !== payload.accountType
  ) {
    throw Errors.forbidden("管理账号已被禁用");
  }
  await prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return {
    adminAccountId: account.id,
    sessionId: session.id,
    accountType: account.accountType,
    username: account.username,
    displayName: account.displayName,
    permissionVersion: account.permissionVersion,
  };
}

export async function managementAuthRequired(req: Request) {
  const token = managementTokenFromRequest(req);
  if (!token) throw Errors.unauthorized("请先登录管理后台");
  const principal = await hydrateManagementPrincipal(token);
  req.management = principal;
  return principal;
}

export async function getManagementSessionView(principal: ManagementPrincipal) {
  const permissions = principal.accountType === "boss"
    ? [...MANAGEMENT_PERMISSION_CODES, ...BOSS_ONLY_PERMISSION_CODES]
    : (await prisma.adminAccountPermission.findMany({
        where: { adminAccountId: principal.adminAccountId },
        orderBy: { permissionCode: "asc" },
        select: { permissionCode: true },
      })).map((row) => row.permissionCode);
  return { ...principal, permissions };
}

export async function issueManagementSession(
  account: { id: number; accountType: string; username: string; displayName: string },
  req: Request,
) {
  if (!isAccountType(account.accountType)) throw Errors.server("管理账号类型无效");
  const sessionId = crypto.randomBytes(24).toString("base64url");
  const token = signManagementToken({
    adminAccountId: account.id,
    sessionId,
    accountType: account.accountType,
  });
  const now = new Date();
  await prisma.adminSession.create({
    data: {
      id: sessionId,
      adminAccountId: account.id,
      tokenHash: hashManagementToken(token),
      ip: String(req.ip || "").slice(0, 128),
      clientLabel: String(req.get("user-agent") || "").slice(0, 500),
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + config.managementSessionAbsoluteMs),
    },
  });
  // The signed token is bound to the DB session and can be revoked independently
  // of JWT expiry.
  await prisma.adminAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: now, lastLoginIp: String(req.ip || "").slice(0, 128) },
  });
  return { token, sessionId };
}

export async function loginManagementAccount(
  username: string,
  password: string,
  otp: string | undefined,
  req: Request,
) {
  const account = await prisma.adminAccount.findUnique({
    where: { username: username.trim() },
    select: {
      id: true,
      username: true,
      displayName: true,
      accountType: true,
      status: true,
      passwordHash: true,
      mfaEnabled: true,
      mfaSecretCiphertext: true,
      permissionVersion: true,
    },
  });
  if (!account || !isAccountType(account.accountType)) throw Errors.badRequest("管理账号或密码错误");
  if (account.status !== "active") throw Errors.forbidden("管理账号已被禁用");
  if (!(await verifyPassword(password, account.passwordHash))) throw Errors.badRequest("管理账号或密码错误");
  if (account.accountType === "boss" && (!account.mfaEnabled || !account.mfaSecretCiphertext)) {
    throw Errors.forbidden("BOSS 账号未完成 MFA 安全配置，禁止登录");
  }
  if (account.mfaEnabled) {
    if (!otp || !account.mfaSecretCiphertext) throw Errors.badRequest("请输入 MFA 验证码");
    let secret = "";
    try { secret = decryptManagementSecret(account.mfaSecretCiphertext); } catch { throw Errors.server("管理账号 MFA 配置无效"); }
    if (!verifyTotp(secret, otp)) throw Errors.badRequest("MFA 验证码错误或已过期");
  }
  const session = await issueManagementSession(account, req);
  return {
    ...session,
    account: {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      accountType: account.accountType,
      mfaEnabled: account.mfaEnabled,
      permissionVersion: account.permissionVersion,
    },
  };
}

export async function revokeManagementSession(sessionId: string, actorId?: number) {
  const session = await prisma.adminSession.findUnique({ where: { id: sessionId }, select: { adminAccountId: true } });
  if (!session || (actorId !== undefined && session.adminAccountId !== actorId)) return false;
  await prisma.adminSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  return true;
}

export async function revokeAllManagementSessions(adminAccountId: number) {
  const result = await prisma.adminSession.updateMany({
    where: { adminAccountId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function hasManagementPermission(
  principal: ManagementPrincipal,
  permission: string,
) {
  if (principal.accountType === "boss") return true;
  if (isBossOnlyPermission(permission)) return false;
  if (!isKnownManagementPermission(permission)) return false;
  const row = await prisma.adminAccountPermission.findUnique({
    where: {
      adminAccountId_permissionCode: {
        adminAccountId: principal.adminAccountId,
        permissionCode: permission,
      },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function requireManagementPermission(
  principal: ManagementPrincipal,
  permission: ManagementPermission,
) {
  if (!(await hasManagementPermission(principal, permission))) {
    throw Errors.forbidden("当前管理账号没有执行此操作的权限");
  }
}
