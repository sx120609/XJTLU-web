import type { Request, Response } from "express";
import { prisma } from "../prisma";
import { verifyToken } from "../utils/jwt";
import { filestoreUpstreamPath } from "./filestoreProxyRuntime";
import {
  hasToolContentManagePermission,
  hasToolManagerPermission,
} from "./serviceTools";

type PlatformFilestoreUser = {
  userId: number;
  username: string;
  nickname: string;
  role: string;
  studentId: string;
  campus: string;
};

export type FilestoreAccessUser = PlatformFilestoreUser & {
  isToolManager: boolean;
};

export function isPublicFilestoreRequest(req: Request) {
  const target = filestoreUpstreamPath(req).split("?")[0];
  if (req.method === "GET" && target === "/api/health") return true;
  if (req.method === "GET" && target === "/api/platform/site-config") {
    return true;
  }
  if (req.method === "GET" && target === "/api/qrcode") return true;
  if (
    req.method === "GET"
    && /^\/api\/public\/(tasks|status)\/[A-Za-z0-9_-]+$/.test(target)
  ) {
    return true;
  }
  if (
    (req.method === "GET" || req.method === "HEAD")
    && /^\/api\/files\/\d+\/public-preview(?:\/[^/]+){0,2}$/.test(target)
  ) {
    return true;
  }
  if (
    req.method === "POST"
    && /^\/api\/submit\/[A-Za-z0-9_-]+$/.test(target)
  ) {
    return true;
  }
  if (
    req.method === "POST"
    && /^\/api\/submit\/[A-Za-z0-9_-]+\/(check-duplicate|prepare-remote|complete-remote)$/.test(
      target,
    )
  ) {
    return true;
  }
  return target !== "/api" && !target.startsWith("/api/");
}

async function platformUserFromRequest(req: Request) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const payload = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        nickname: true,
        role: true,
        status: true,
      },
    });
    if (!user || user.status === "banned") return null;
    return {
      ...payload,
      studentId: user.username,
      username: user.username,
      nickname: user.nickname || user.username,
      role: user.role,
    } satisfies PlatformFilestoreUser;
  } catch {
    return null;
  }
}

export async function assertFilestoreAccess(
  req: Request,
  res: Response,
): Promise<FilestoreAccessUser | null | false> {
  if (isPublicFilestoreRequest(req)) return null;
  const user = await platformUserFromRequest(req);
  if (!user?.userId) {
    res.status(401).json({ error: "请先登录平台账号" });
    return false;
  }
  const isToolManager = await hasToolManagerPermission("file_collect", user);
  if (
    !isToolManager
    && !(await hasToolContentManagePermission("file_collect", user))
  ) {
    res.status(403).json({ error: "没有文件收集管理权限" });
    return false;
  }
  return { ...user, isToolManager };
}
