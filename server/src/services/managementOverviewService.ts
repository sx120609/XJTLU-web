import { prisma } from "../prisma";

export async function getManagementOverview() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [
    personalUsers,
    activePersonalUsers,
    managementAccounts,
    topics,
    todayTopics,
    pendingForumTopics,
    pendingForumReplies,
    pendingPhysicalItems,
    pendingLearningMaterials,
    recentAuditActions,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "user" } }),
    prisma.user.count({ where: { role: "user", status: "active" } }),
    prisma.adminAccount.count(),
    prisma.topic.count(),
    prisma.topic.count({ where: { createdAt: { gte: since } } }),
    prisma.topic.count({ where: { aiReviewStatus: { in: ["manual_requested", "manual_reviewing"] } } }),
    prisma.reply.count({ where: { aiReviewStatus: { in: ["manual_requested", "manual_reviewing"] } } }),
    prisma.marketItem.count({ where: { status: "reviewing", visibility: "public", deliveryType: "physical" } }),
    prisma.learningMaterialReview.count({ where: { status: { in: ["submitted", "reviewing"] } } }),
    prisma.managementAuditLog.count({ where: { createdAt: { gte: since } } }),
  ]);
  return {
    generatedAt: new Date(),
    personalUsers: { total: personalUsers, active: activePersonalUsers },
    managementAccounts,
    forum: {
      topics,
      todayTopics,
      pendingTopics: pendingForumTopics,
      pendingReplies: pendingForumReplies,
    },
    reviewQueues: {
      physicalItems: pendingPhysicalItems,
      learningMaterials: pendingLearningMaterials,
    },
    todayAuditActions: recentAuditActions,
  };
}
