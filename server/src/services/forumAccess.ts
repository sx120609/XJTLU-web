import { prisma } from "../prisma";
import { Errors } from "../utils/response";

export const FORUM_CONFIRM_TEXT = "我知道了";

export function isForumStaffRole(role?: string | null) {
  return role === "admin" || role === "mod" || role === "bot";
}

export function forumAccessErrorMessage(isLoggedIn: boolean) {
  return isLoggedIn
    ? "当前账号无法使用论坛"
    : "请先登录后参与论坛";
}

export async function resolveForumAccess(userId?: number | null, role?: string | null) {
  if (isForumStaffRole(role)) return true;
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  return Boolean(user && user.status !== "banned");
}

export async function ensureForumAccessEnabled(userId: number, role?: string | null) {
  if (isForumStaffRole(role)) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumEnabled: true, status: true },
  });
  if (!user) throw Errors.notFound("用户不存在");
  if (user.status === "banned") throw Errors.forbidden(forumAccessErrorMessage(true));
  if (!user.forumEnabled) {
    await prisma.user.update({
      where: { id: userId },
      data: { forumEnabled: true, forumEnabledAt: new Date() },
    });
  }
}

export async function ensureCanReadBoardType(boardType: string | null | undefined, userId?: number | null, role?: string | null) {
  if (boardType === "announce") return;
  const allowed = await resolveForumAccess(userId, role);
  if (!allowed) throw Errors.forbidden(forumAccessErrorMessage(Boolean(userId)));
}
