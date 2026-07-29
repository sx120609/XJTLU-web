import { prisma } from "../prisma";

type ForumStatsClient = Pick<
  typeof prisma,
  "topic" | "board" | "user" | "reply" | "course" | "courseRating"
>;

function uniquePositiveIds(ids: Iterable<number>) {
  return [...new Set(Array.from(ids).filter((id) => Number.isFinite(id) && id > 0))];
}

export async function refreshBoardTopicCount(boardId: number, client: ForumStatsClient = prisma) {
  const topicCount = await client.topic.count({
    where: { boardId, hidden: false },
  });
  await client.board.update({
    where: { id: boardId },
    data: { topicCount },
  });
  return topicCount;
}

export async function refreshBoardTopicCounts(boardIds: Iterable<number>, client: ForumStatsClient = prisma) {
  const ids = uniquePositiveIds(boardIds);
  await Promise.all(ids.map((boardId) => refreshBoardTopicCount(boardId, client)));
}

export async function refreshUserPostCount(userId: number, client: ForumStatsClient = prisma) {
  const postCount = await client.topic.count({
    where: { authorId: userId, hidden: false },
  });
  await client.user.update({
    where: { id: userId },
    data: { postCount },
  });
  return postCount;
}

export async function refreshUserReplyCount(userId: number, client: ForumStatsClient = prisma) {
  const replyCount = await client.reply.count({
    where: { authorId: userId, hidden: false },
  });
  await client.user.update({
    where: { id: userId },
    data: { replyCount },
  });
  return replyCount;
}

export async function refreshTopicReplyStats(topicId: number, client: ForumStatsClient = prisma) {
  const topic = await client.topic.findUnique({
    where: { id: topicId },
    select: { id: true, authorId: true, createdAt: true },
  });
  if (!topic) return null;

  const [replyCount, lastReply] = await Promise.all([
    client.reply.count({
      where: { topicId, hidden: false },
    }),
    client.reply.findFirst({
      where: { topicId, hidden: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true, authorId: true },
    }),
  ]);
  await client.topic.update({
    where: { id: topicId },
    data: {
      replyCount,
      lastReplyAt: lastReply?.createdAt ?? topic.createdAt,
      lastReplyById: lastReply?.authorId ?? topic.authorId,
    },
  });
  return {
    replyCount,
    lastReplyAt: lastReply?.createdAt ?? topic.createdAt,
    lastReplyById: lastReply?.authorId ?? topic.authorId,
  };
}

export async function refreshCourseRatingAggregates(
  courseIds: Iterable<number>,
  client: ForumStatsClient = prisma,
) {
  const ids = uniquePositiveIds(courseIds);
  for (const courseId of ids) {
    const aggregate = await client.courseRating.aggregate({
      where: { courseId },
      _count: true,
      _avg: {
        difficulty: true,
        reward: true,
        recommend: true,
        givingScore: true,
      },
    });
    await client.course.updateMany({
      where: { id: courseId },
      data: {
        ratingCount: aggregate._count,
        avgDifficulty: aggregate._avg.difficulty ?? 0,
        avgReward: aggregate._avg.reward ?? 0,
        avgRecommend: aggregate._avg.recommend ?? 0,
        avgScore: aggregate._avg.givingScore ?? 0,
      },
    });
  }
}
