import { prisma } from "../prisma";

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
  const merchantExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

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
    merchantApplications,
    merchantApproved,
    merchantActive,
    merchantInquiries,
    promotionApplications,
    promotionConfirmed,
    promotionImpressions,
    promotionClicks,
    promotionRevenue,
    pendingItems,
    pendingWanted,
    pendingReports,
    pendingAppeals,
    pendingMerchants,
    pendingPromotions,
    expiringMerchants,
    staleReports,
    stalePromotions,
    actionLogs,
    reports,
    appeals,
    violations,
  ] = await Promise.all([
    prisma.marketItem.count({ where: { createdAt: { gte: since }, listingType: "sell", deliveryType: "physical", visibility: "public" } }),
    prisma.tradeIntent.count({ where: { createdAt: { gte: since } } }),
    prisma.marketOrder.count({ where: { createdAt: { gte: since }, deliveryType: "physical" } }),
    prisma.marketOrder.count({ where: { completedAt: { gte: since }, deliveryType: "physical", status: "completed" } }),
    prisma.wantedPost.count({ where: { createdAt: { gte: since } } }),
    prisma.wantedResponse.count({ where: { createdAt: { gte: since } } }),
    prisma.marketOrder.count({ where: { createdAt: { gte: since }, wantedPostId: { not: null } } }),
    prisma.wantedPost.count({ where: { updatedAt: { gte: since }, status: "completed" } }),
    prisma.learningMaterialProfile.count({ where: { createdAt: { gte: since } } }),
    prisma.learningMaterialVersion.count({ where: { publishedAt: { gte: since }, status: "active" } }),
    prisma.learningMaterialAccess.count({ where: { grantedAt: { gte: since } } }),
    prisma.learningMaterialAccess.aggregate({ where: { grantedAt: { gte: since } }, _sum: { downloadCount: true } }),
    prisma.merchantProfile.count({ where: { createdAt: { gte: since } } }),
    prisma.merchantProfile.count({ where: { reviewedAt: { gte: since }, status: "approved" } }),
    prisma.merchantProfile.count({ where: { status: "approved", activeUntil: { gt: now } } }),
    prisma.merchantInquiry.count({ where: { createdAt: { gte: since } } }),
    prisma.promotionOrder.count({ where: { createdAt: { gte: since } } }),
    prisma.promotionOrder.count({ where: { confirmedAt: { gte: since }, paymentMode: "manual" } }),
    prisma.promotionEvent.count({ where: { createdAt: { gte: since }, type: "impression" } }),
    prisma.promotionEvent.count({ where: { createdAt: { gte: since }, type: "click" } }),
    prisma.promotionOrder.aggregate({ where: { confirmedAt: { gte: since }, paymentMode: "manual" }, _sum: { amountCents: true } }),
    prisma.marketItem.count({ where: { status: "reviewing" } }),
    prisma.wantedPost.count({ where: { status: "reviewing" } }),
    prisma.marketReport.count({ where: { status: "pending" } }),
    prisma.marketAppeal.count({ where: { status: "pending" } }),
    prisma.merchantProfile.count({ where: { status: "reviewing" } }),
    prisma.promotionOrder.count({ where: { status: "pending" } }),
    prisma.merchantProfile.count({ where: { status: "approved", activeUntil: { gt: now, lte: merchantExpiry } } }),
    prisma.marketReport.count({ where: { status: "pending", createdAt: { lt: staleBefore } } }),
    prisma.promotionOrder.count({ where: { status: "pending", createdAt: { lt: staleBefore } } }),
    prisma.adminActionLog.findMany({ include: { actor: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.marketReport.findMany({ include: { reporter: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.marketAppeal.findMany({ include: { user: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.marketViolation.findMany({ include: { user: { select: { id: true, nickname: true } }, createdBy: { select: { id: true, nickname: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const [promotionAdjustments, confirmedOrderRows, merchantReviewDue] = await Promise.all([
    prisma.promotionAdjustment.groupBy({
      by: ["type"],
      where: { createdAt: { gte: since } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.promotionOrder.findMany({
      where: { confirmedAt: { gte: since }, paymentMode: "manual" },
      select: {
        createdAt: true,
        confirmedAt: true,
        manualCostCents: true,
        type: true,
        clickCount: true,
        inquiryStartCount: true,
        inquiryEndCount: true,
        merchantProfile: { select: { inquiryCount: true } },
      },
    }),
    prisma.merchantProfile.count({ where: { status: "approved", reviewDueAt: { lte: now } } }),
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
  const merchantPromotionRows = confirmedOrderRows.filter((row) => row.type === "merchant_homepage");
  const merchantInquiriesAttributed = merchantPromotionRows.reduce((sum, row) => {
    const current = row.inquiryEndCount ?? row.merchantProfile?.inquiryCount ?? row.inquiryStartCount;
    return sum + Math.max(0, current - row.inquiryStartCount);
  }, 0);
  const merchantPromotionClicks = merchantPromotionRows.reduce((sum, row) => sum + row.clickCount, 0);
  const funnels = [
    {
      key: "trade",
      label: "可信交易",
      note: "公开发布 → 购买意向 → 预约 → 双方完成",
      stages: [stage("新发布", listings), stage("购买意向", intents), stage("生成预约", reservations), stage("双方完成", completedTrades)],
    },
    {
      key: "wanted",
      label: "求购撮合",
      note: "求购发布 → 卖家响应 → 接受预约 → 求购完成",
      stages: [stage("新求购", wantedPosts), stage("收到响应", wantedResponses), stage("接受预约", wantedReservations), stage("确认求到", wantedCompleted)],
    },
    {
      key: "learning",
      label: "免费原创",
      note: "资料建档 → 版本发布 → 获得访问 → 下载使用",
      stages: [stage("资料建档", freeMaterials), stage("版本发布", activeVersions), stage("获得访问", materialAccesses), stage("下载次数", materialDownloads._sum.downloadCount || 0)],
    },
    {
      key: "merchant",
      label: "合作商户",
      note: "提交资料 → 人工通过 → 主页有效 → 用户咨询",
      stages: [stage("资料提交", merchantApplications), stage("人工通过", merchantApproved), stage("当前有效", merchantActive), stage("咨询动作", merchantInquiries)],
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
    { key: "merchant", label: "商户审核", count: pendingMerchants, overdue: 0, route: "/admin?tab=promotion" },
    { key: "merchant-review", label: "商户周期复核到期", count: merchantReviewDue, overdue: merchantReviewDue, route: "/admin?tab=promotion" },
    { key: "promotion", label: "盈利订单人工确认", count: pendingPromotions, overdue: stalePromotions, route: "/admin?tab=promotion" },
    { key: "expiry", label: "7 天内商户主页到期", count: expiringMerchants, overdue: 0, route: "/admin?tab=promotion" },
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
      merchantInquiryConversion: merchantPromotionClicks ? Number(((merchantInquiriesAttributed / merchantPromotionClicks) * 100).toFixed(2)) : 0,
      promotionCtr: promotionImpressions ? Number(((promotionClicks / promotionImpressions) * 100).toFixed(2)) : 0,
    },
    funnels,
    queues,
    timeline,
  };
}
