import { prisma } from "../prisma";
import { getRuntimeHealthSnapshot } from "./runtimeHealth";
import { shanghaiDateKey } from "./v1ProductAnalytics";
import { FEATURED_XJTLU_APPS } from "./xjtluEhallClient";

function amount(cents: number) {
  return (cents / 100).toFixed(2);
}

function stage(label: string, value: number) {
  return { label, value };
}

export async function getMarketOperationsDashboard(windowDays = 30, now = new Date()) {
  const days = Math.min(90, Math.max(7, Math.trunc(windowDays) || 30));
  const since = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60_000);

  const [
    listings,
    intents,
    reservations,
    completedTrades,
    wantedPosts,
    wantedResponses,
    wantedReservations,
    wantedCompleted,
    freeMaterials,
    activeVersions,
    materialAccesses,
    materialDownloads,
    promotionApplications,
    promotionConfirmed,
    promotionImpressions,
    promotionClicks,
    promotionRevenue,
    pendingItems,
    pendingWanted,
    pendingReports,
    pendingAppeals,
    pendingPromotions,
    staleReports,
    stalePromotions,
    actionLogs,
    reports,
    appeals,
    violations,
  ] = await Promise.all([
    prisma.marketItem.count({ where: { createdAt: { gte: since }, listingType: "sell", deliveryType: "physical", visibility: "public" } }),
    prisma.marketConversation.count({ where: { createdAt: { gte: since }, item: { deliveryType: "physical" } } }),
    prisma.marketOrder.count({ where: { createdAt: { gte: since }, deliveryType: "physical", status: { in: ["negotiating", "completed"] } } }),
    prisma.marketOrder.count({ where: { completedAt: { gte: since }, deliveryType: "physical", status: "completed" } }),
    prisma.wantedPost.count({ where: { createdAt: { gte: since } } }),
    prisma.wantedResponse.count({ where: { createdAt: { gte: since } } }),
    prisma.marketOrder.count({ where: { createdAt: { gte: since }, wantedPostId: { not: null } } }),
    prisma.wantedPost.count({ where: { updatedAt: { gte: since }, status: "completed" } }),
    prisma.learningMaterialProfile.count({ where: { createdAt: { gte: since } } }),
    prisma.learningMaterialVersion.count({ where: { publishedAt: { gte: since }, status: "active" } }),
    prisma.learningMaterialAccess.count({ where: { grantedAt: { gte: since } } }),
    prisma.learningMaterialAccess.aggregate({ where: { grantedAt: { gte: since } }, _sum: { downloadCount: true } }),
    prisma.promotionOrder.count({ where: { createdAt: { gte: since }, targetType: { not: "merchant_profile" } } }),
    prisma.promotionOrder.count({ where: { confirmedAt: { gte: since }, paymentMode: "manual", targetType: { not: "merchant_profile" } } }),
    prisma.promotionEvent.count({ where: { createdAt: { gte: since }, type: "impression", order: { targetType: { not: "merchant_profile" } } } }),
    prisma.promotionEvent.count({ where: { createdAt: { gte: since }, type: "click", order: { targetType: { not: "merchant_profile" } } } }),
    prisma.promotionOrder.aggregate({ where: { confirmedAt: { gte: since }, paymentMode: "manual", targetType: { not: "merchant_profile" } }, _sum: { amountCents: true } }),
    prisma.marketItem.count({ where: { status: "reviewing" } }),
    prisma.wantedPost.count({ where: { status: "reviewing" } }),
    prisma.marketReport.count({ where: { status: "pending" } }),
    prisma.marketAppeal.count({ where: { status: "pending" } }),
    prisma.promotionOrder.count({ where: { status: "pending", targetType: { not: "merchant_profile" } } }),
    prisma.marketReport.count({ where: { status: "pending", createdAt: { lt: staleBefore } } }),
    prisma.promotionOrder.count({ where: { status: "pending", createdAt: { lt: staleBefore }, targetType: { not: "merchant_profile" } } }),
    prisma.adminActionLog.findMany({ include: { actor: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.marketReport.findMany({ include: { reporter: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.marketAppeal.findMany({ include: { user: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.marketViolation.findMany({ include: { user: { select: { id: true, nickname: true } }, createdBy: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const [promotionAdjustments, confirmedOrderRows] = await Promise.all([
    prisma.promotionAdjustment.groupBy({
      by: ["type"],
      where: { createdAt: { gte: since }, order: { targetType: { not: "merchant_profile" } } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.promotionOrder.findMany({
      where: { confirmedAt: { gte: since }, paymentMode: "manual", targetType: { not: "merchant_profile" } },
      select: {
        createdAt: true,
        confirmedAt: true,
        manualCostCents: true,
      },
    }),
  ]);

  const currentWeekStart = shanghaiDateKey(new Date(now.getTime() - 6 * 86_400_000));
  const previousWeekStart = shanghaiDateKey(new Date(now.getTime() - 13 * 86_400_000));
  const previousWeekEnd = shanghaiDateKey(new Date(now.getTime() - 7 * 86_400_000));
  const todayKey = shanghaiDateKey(now);
  const [
    activityRows,
    verifiedCampusUsers,
    physicalSupply,
    wantedSupply,
    learningSupply,
    activePublishers,
    publicSquareContent,
    pendingLearningReviews,
    pendingLearningEvidence,
    pendingLearningIssues,
    overdueLearningIssues,
    pendingCreatorAppeals,
  ] = await Promise.all([
    prisma.productActivityDaily.findMany({
      where: { dateKey: { gte: previousWeekStart, lte: todayKey } },
      select: { userId: true, dateKey: true, surface: true, source: true, visitCount: true },
    }),
    prisma.user.count({ where: { studentSso: true, status: "active" } }),
    prisma.marketItem.count({
      where: {
        listingType: "sell",
        deliveryType: "physical",
        visibility: "public",
        status: "active",
      },
    }),
    prisma.wantedPost.count({ where: { status: { in: ["active", "responded"] }, expiresAt: { gt: now } } }),
    prisma.marketItem.count({
      where: {
        category: "digital_goods",
        status: "active",
        learningMaterial: { is: { commerceMode: "paid", activeVersionId: { not: null } } },
      },
    }),
    prisma.learningCreatorProfile.count({ where: { status: "active" } }),
    prisma.topic.count({
      where: {
        hidden: false,
        board: { section: { not: null } },
      },
    }),
    prisma.learningMaterialReview.count({ where: { status: { in: ["submitted", "reviewing"] } } }),
    prisma.learningPaymentEvidence.count({ where: { status: "submitted" } }),
    prisma.learningOrderIssue.count({
      where: { status: { in: ["open", "waiting_buyer", "waiting_seller", "refund_requested"] } },
    }),
    prisma.learningOrderIssue.count({
      where: {
        status: { in: ["open", "waiting_buyer", "waiting_seller", "refund_requested"] },
        slaDueAt: { lt: now },
      },
    }),
    prisma.learningCreatorAppeal.count({ where: { status: "pending" } }),
  ]);

  const revenueCents = promotionRevenue._sum.amountCents || 0;
  const adjustmentByType = new Map(promotionAdjustments.map((row) => [row.type, row]));
  const refundCents = adjustmentByType.get("refund_record")?._sum.amountCents || 0;
  const compensationCents = adjustmentByType.get("compensation_record")?._sum.amountCents || 0;
  const manualCostCents = confirmedOrderRows.reduce((sum, row) => sum + row.manualCostCents, 0);
  const netContributionCents = revenueCents - refundCents - compensationCents - manualCostCents;
  const complaintCount = adjustmentByType.get("complaint_record")?._count || 0;
  const reviewDurations = confirmedOrderRows
    .filter((row) => row.confirmedAt)
    .map((row) => Math.max(0, new Date(row.confirmedAt!).getTime() - row.createdAt.getTime()));
  const averageManualReviewMinutes = reviewDurations.length
    ? Number((reviewDurations.reduce((sum, value) => sum + value, 0) / reviewDurations.length / 60_000).toFixed(1))
    : 0;
  const funnels = [
    {
      key: "trade",
      label: "可信交易",
      note: "公开发布 → 发起私聊 → 双方确认 → 系统认定成交",
      stages: [stage("新发布", listings), stage("发起私聊", intents), stage("进入洽谈", reservations), stage("双方确认成交", completedTrades)],
    },
    {
      key: "wanted",
      label: "求购撮合",
      note: "求购发布 → 卖家响应 → 发起私聊 → 双方确认成交",
      stages: [stage("新求购", wantedPosts), stage("收到响应", wantedResponses), stage("发起私聊", wantedReservations), stage("双方确认成交", wantedCompleted)],
    },
    {
      key: "learning",
      label: "付费学习资料",
      note: "资料建档 → 版本发布 → 获得访问 → 下载使用",
      stages: [stage("资料建档", freeMaterials), stage("版本发布", activeVersions), stage("获得访问", materialAccesses), stage("下载次数", materialDownloads._sum.downloadCount || 0)],
    },
    {
      key: "promotion",
      label: "推广服务",
      note: "申请 → 管理员人工确认 → 曝光 → 点击",
      stages: [stage("推广申请", promotionApplications), stage("人工确认", promotionConfirmed), stage("去重曝光", promotionImpressions), stage("去重点击", promotionClicks)],
    },
  ];

  const queues = [
    { key: "content", label: "内容审核", count: pendingItems + pendingWanted, overdue: 0, route: "/admin?tab=market" },
    { key: "report", label: "举报处理", count: pendingReports, overdue: staleReports, route: "/admin?tab=market" },
    { key: "appeal", label: "用户申诉", count: pendingAppeals, overdue: 0, route: "/admin?tab=market" },
    { key: "promotion", label: "盈利订单人工确认", count: pendingPromotions, overdue: stalePromotions, route: "/admin?tab=promotion" },
    { key: "learning-review", label: "学习资料审核", count: pendingLearningReviews, overdue: 0, route: "/admin?tab=learning-commerce" },
    { key: "learning-evidence", label: "收款凭证核验", count: pendingLearningEvidence, overdue: 0, route: "/admin?tab=learning-commerce" },
    { key: "learning-issue", label: "资料售后与争议", count: pendingLearningIssues, overdue: overdueLearningIssues, route: "/admin?tab=learning-commerce" },
    { key: "publisher-appeal", label: "资料发布者申诉", count: pendingCreatorAppeals, overdue: 0, route: "/admin?tab=learning-commerce" },
  ];

  const activeToday = new Set(activityRows.filter((row) => row.dateKey === todayKey).map((row) => row.userId));
  const activeCurrentWeek = new Set(
    activityRows.filter((row) => row.dateKey >= currentWeekStart).map((row) => row.userId),
  );
  const activePreviousWeek = new Set(
    activityRows
      .filter((row) => row.dateKey >= previousWeekStart && row.dateKey <= previousWeekEnd)
      .map((row) => row.userId),
  );
  const returningUsers = [...activePreviousWeek].filter((userId) => activeCurrentWeek.has(userId)).length;
  const surfaceActiveUsers = ["schedule", "portal", "square", "market", "learning"].map((surface) => ({
    surface,
    users: new Set(
      activityRows
        .filter((row) => row.dateKey >= currentWeekStart && row.surface === surface)
        .map((row) => row.userId),
    ).size,
    visits: activityRows
      .filter((row) => row.dateKey >= currentWeekStart && row.surface === surface)
      .reduce((sum, row) => sum + row.visitCount, 0),
  }));
  const coreEntrants = activityRows.filter((row) => (
    row.dateKey >= currentWeekStart
    && ["market", "learning"].includes(row.surface)
    && ["schedule", "portal", "square"].includes(row.source)
  ));
  const transitionUsers = new Set(coreEntrants.map((row) => row.userId)).size;
  const runtimeJobs = getRuntimeHealthSnapshot(now.getTime()).jobs;
  const failedRuntimeJobs = runtimeJobs.filter((job) => job.status === "failed");
  const readinessChecks = [
    { key: "physical_supply", label: "在售实体商品", current: physicalSupply, target: 20, passed: physicalSupply >= 20 },
    { key: "wanted_supply", label: "进行中求购", current: wantedSupply, target: 5, passed: wantedSupply >= 5 },
    { key: "learning_supply", label: "已审核付费资料", current: learningSupply, target: 5, passed: learningSupply >= 5 },
    { key: "publisher_supply", label: "活跃资料发布者", current: activePublishers, target: 3, passed: activePublishers >= 3 },
    { key: "square_supply", label: "广场公开内容", current: publicSquareContent, target: 10, passed: publicSquareContent >= 10 },
    { key: "portal_entries", label: "校园门户入口", current: FEATURED_XJTLU_APPS.length, target: 15, passed: FEATURED_XJTLU_APPS.length >= 15 },
    {
      key: "overdue_governance",
      label: "超时治理任务",
      current: queues.reduce((sum, queue) => sum + queue.overdue, 0),
      target: 0,
      passed: queues.every((queue) => queue.overdue === 0),
    },
    {
      key: "runtime_health",
      label: "后台任务故障",
      current: failedRuntimeJobs.length,
      target: 0,
      passed: failedRuntimeJobs.length === 0,
    },
  ];

  const timeline = [
    ...actionLogs.map((row) => ({
      id: `action-${row.id}`,
      kind: "action",
      title: row.summary,
      status: "recorded",
      actor: row.actor?.nickname || "系统",
      target: `${row.targetType}${row.targetId ? ` #${row.targetId}` : ""}`,
      createdAt: row.createdAt,
    })),
    ...reports.map((row) => ({
      id: `report-${row.id}`,
      kind: "report",
      title: `举报：${row.reason}`,
      status: row.status,
      actor: row.reporter?.nickname || "校园用户",
      target: `${row.type} #${row.itemId || row.wantedPostId || row.orderId || row.reportedUserId || row.id}`,
      createdAt: row.createdAt,
    })),
    ...appeals.map((row) => ({
      id: `appeal-${row.id}`,
      kind: "appeal",
      title: `申诉：${row.content.slice(0, 80)}`,
      status: row.status,
      actor: row.user?.nickname || "校园用户",
      target: `violation #${row.violationId}`,
      createdAt: row.createdAt,
    })),
    ...violations.map((row) => ({
      id: `violation-${row.id}`,
      kind: "violation",
      title: `信用处理：${row.reason}`,
      status: row.status,
      actor: row.createdBy?.nickname || "系统",
      target: row.user?.nickname || `用户 #${row.userId}`,
      createdAt: row.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 60);

  return {
    generatedAt: now,
    window: { days, since, until: now },
    headline: {
      pendingTotal: queues.reduce((sum, queue) => sum + queue.count, 0),
      overdueTotal: queues.reduce((sum, queue) => sum + queue.overdue, 0),
      promotionRevenueCents: revenueCents,
      promotionRevenue: amount(revenueCents),
      promotionNetContributionCents: netContributionCents,
      promotionNetContribution: amount(netContributionCents),
      promotionManualCostCents: manualCostCents,
      promotionManualCost: amount(manualCostCents),
      promotionRefundCents: refundCents,
      promotionCompensationCents: compensationCents,
      promotionComplaintCount: complaintCount,
      promotionComplaintRate: promotionConfirmed ? Number(((complaintCount / promotionConfirmed) * 100).toFixed(2)) : 0,
      averageManualReviewMinutes,
      promotionCtr: promotionImpressions ? Number(((promotionClicks / promotionImpressions) * 100).toFixed(2)) : 0,
      verifiedCampusUsers,
      dau: activeToday.size,
      wau: activeCurrentWeek.size,
      sevenDayReturnRate: activePreviousWeek.size
        ? Number(((returningUsers / activePreviousWeek.size) * 100).toFixed(2))
        : 0,
      coreEntryUsers: transitionUsers,
    },
    product: {
      today: todayKey,
      dau: activeToday.size,
      wau: activeCurrentWeek.size,
      previousWeekUsers: activePreviousWeek.size,
      returningUsers,
      sevenDayReturnRate: activePreviousWeek.size
        ? Number(((returningUsers / activePreviousWeek.size) * 100).toFixed(2))
        : 0,
      surfaceActiveUsers,
      coreEntryUsers: transitionUsers,
    },
    readiness: {
      ready: readinessChecks.every((check) => check.passed),
      passed: readinessChecks.filter((check) => check.passed).length,
      total: readinessChecks.length,
      checks: readinessChecks,
      failedRuntimeJobs: failedRuntimeJobs.map((job) => ({
        key: job.key,
        label: job.label,
        error: job.lastError,
      })),
      note: "上线前仍须执行仓库内完整测试、数据库迁移校验、备份恢复演练与回滚检查。",
    },
    funnels,
    queues,
    timeline,
  };
}
