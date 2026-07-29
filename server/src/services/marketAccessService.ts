import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { isFeatureOn } from "./siteSettings";
import {
  ensureMarketAccess,
  type MarketAccessAction,
} from "./marketTrust";

export async function requireVerifiedMarketUser(
  userId: number,
  role: string,
  action: MarketAccessAction = "trade",
) {
  if (!isFeatureOn("market")) throw Errors.forbidden("市集当前已关闭");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      studentSso: true,
      forumEnabled: true,
      status: true,
      topicSubmissionLocked: true,
    },
  });
  if (!user) throw Errors.unauthorized();
  if (role !== "admin" && role !== "mod" && !user.studentSso) {
    throw Errors.forbidden("仅限通过 XJTLU 统一认证的用户使用商城");
  }
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  await ensureMarketAccess(prisma, userId, action, role);
  return user;
}
