import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import {
  backfillAdminDailyLoginsFromLastLogin,
  getChinaDayRange,
  listAdminDailyLoginSeries,
} from "./adminStats";

export type AdminOverviewActor = {
  role: string;
};

function requireModerator(actor: AdminOverviewActor) {
  if (!["admin", "mod"].includes(actor.role)) {
    throw Errors.forbidden("仅管理员或版主可查看后台概览");
  }
}

export async function getAdminOverview(actor: AdminOverviewActor) {
  requireModerator(actor);
  const { start: todayStart, end: todayEnd } = getChinaDayRange();
  const regularUserWhere = { role: "user" as const };
  await backfillAdminDailyLoginsFromLastLogin(30).catch((error) => {
    console.warn("[admin-stats] failed to backfill daily logins", error);
  });

  const [
    users,
    banned,
    topics,
    hiddenTopics,
    replies,
    todayTopics,
    feeds,
    boards,
    iosClients,
    androidClients,
    harmonyClients,
    todayLogins,
    forumEligibleUsers,
    forumEnabledUsers,
    forumEnabledToday,
    dailyActiveSeries,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "banned" } }),
    prisma.topic.count({ where: { hidden: false } }),
    prisma.topic.count({ where: { hidden: true } }),
    prisma.reply.count({ where: { hidden: false } }),
    prisma.topic.count({
      where: {
        createdAt: { gte: todayStart, lt: todayEnd },
        hidden: false,
      },
    }),
    prisma.schoolFeedSource.count({ where: { enabled: true } }),
    prisma.board.count(),
    prisma.user.count({ where: { usedIosClient: true } }),
    prisma.user.count({ where: { usedAndroidClient: true } }),
    prisma.user.count({ where: { usedHarmonyClient: true } }),
    prisma.user.count({
      where: {
        lastLoginAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.user.count({ where: regularUserWhere }),
    prisma.user.count({
      where: { ...regularUserWhere, forumEnabled: true },
    }),
    prisma.user.count({
      where: {
        ...regularUserWhere,
        forumEnabled: true,
        forumEnabledAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    listAdminDailyLoginSeries(30),
  ]);
  const forumPendingUsers = Math.max(
    0,
    forumEligibleUsers - forumEnabledUsers,
  );
  const normalizedDailyActiveSeries = dailyActiveSeries.map((item) => ({
    ...item,
  }));
  const dailyActiveToday = normalizedDailyActiveSeries.at(-1);
  if (dailyActiveToday) {
    dailyActiveToday.count = Math.max(dailyActiveToday.count, todayLogins);
  }
  return {
    users,
    banned,
    topics,
    hiddenTopics,
    replies,
    todayTopics,
    feeds,
    boards,
    iosClients,
    androidClients,
    harmonyClients,
    todayLogins,
    forumEligibleUsers,
    forumEnabledUsers,
    forumPendingUsers,
    forumEnabledToday,
    dailyActiveSeries: normalizedDailyActiveSeries,
  };
}
