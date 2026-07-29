import path from "node:path";
import { stat } from "node:fs/promises";
import { prisma } from "../src/prisma";
import { LEARNING_MATERIAL_SEMESTERS } from "../src/services/learningMaterials";

const root = path.resolve(process.cwd(), "runtime", "learning-materials");
const semesterValues = new Set(LEARNING_MATERIAL_SEMESTERS.map((item) => item.value));

async function main() {
  const issues: string[] = [];
  const [activeItems, profiles, activeVersions, files, accesses, accessEvents, ratings, orderIssues, creatorProfiles, supportTickets, config] = await Promise.all([
    prisma.marketItem.findMany({ where: { category: "digital_goods", status: "active" }, select: { id: true, learningMaterial: { select: { id: true } } } }),
    prisma.learningMaterialProfile.findMany({ select: { id: true, itemId: true, typeId: true, courseCode: true, applicableSemester: true, rightsConfirmedAt: true, activeVersionId: true, item: { select: { status: true } }, type: { select: { status: true, enabled: true } } } }),
    prisma.learningMaterialVersion.findMany({ where: { status: "active" }, select: { id: true, profileId: true, files: { where: { status: "active" }, select: { id: true } } } }),
    prisma.learningMaterialFile.findMany({ where: { status: "active" }, select: { id: true, relativePath: true, fileSize: true, versionId: true, format: true, pageCount: true, previewEnabled: true, previewPageStart: true, previewPageEnd: true } }),
    prisma.learningMaterialAccess.findMany({ where: { revokedAt: null }, select: { id: true, userId: true, versionId: true, order: { select: { buyerId: true, itemId: true, status: true } }, version: { select: { profile: { select: { itemId: true } } } } } }),
    prisma.learningMaterialAccessEvent.findMany({ select: { id: true, accessId: true, fileId: true, userId: true, orderId: true, itemId: true, action: true, watermarkCode: true, access: { select: { userId: true, orderId: true } }, file: { select: { version: { select: { profile: { select: { itemId: true } } } } } } } }),
    prisma.learningMaterialRating.findMany({ where: { status: "published" }, select: { id: true, commerceOrderId: true, itemId: true, buyerId: true, creatorId: true, overall: true, commerceOrder: { select: { status: true, order: { select: { itemId: true, buyerId: true, sellerId: true } } } } } }),
    prisma.learningOrderIssue.findMany({ where: { status: { in: ["open", "waiting_buyer", "waiting_seller", "refund_requested"] } }, select: { id: true, slaDueAt: true, messages: { select: { id: true }, take: 1 } } }),
    prisma.learningCreatorProfile.findMany({ select: { id: true, qualityScore: true, averageRatingBps: true, refundRateBps: true, disputeRateBps: true } }),
    prisma.learningMaterialSupportTicket.findMany({ select: { id: true, buyerId: true, sellerId: true, order: { select: { buyerId: true, sellerId: true, item: { select: { category: true } } } } } }),
    prisma.marketConfig.findUnique({ where: { id: 1 }, select: { commissionBps: true, learningMaterialCommissionBps: true } }),
  ]);

  for (const item of activeItems) if (!item.learningMaterial) issues.push(`在售资料商品 ${item.id} 缺少 LearningMaterialProfile`);
  for (const profile of profiles) {
    const itemIsActive = profile.item.status === "active";
    if (itemIsActive && !profile.courseCode?.trim()) issues.push(`在售资料档案 ${profile.id} 缺少课程代码`);
    if (profile.applicableSemester && !semesterValues.has(profile.applicableSemester)) issues.push(`资料档案 ${profile.id} 的适用学期无效`);
    if (itemIsActive && (!profile.applicableSemester || !semesterValues.has(profile.applicableSemester))) issues.push(`在售资料档案 ${profile.id} 缺少有效适用学期`);
    if (itemIsActive && (!profile.typeId || !profile.type || profile.type.status !== "approved" || !profile.type.enabled)) issues.push(`在售资料档案 ${profile.id} 的资料类型不可发布`);
    if (itemIsActive && !profile.rightsConfirmedAt) issues.push(`在售资料档案 ${profile.id} 未完成原创/权利确认`);
    if (itemIsActive && !profile.activeVersionId) issues.push(`在售资料档案 ${profile.id} 没有有效版本`);
  }
  for (const version of activeVersions) if (!version.files.length) issues.push(`有效版本 ${version.id} 没有可交付文件`);
  for (const file of files) {
    const absolute = path.resolve(root, file.relativePath);
    if (!absolute.startsWith(`${root}${path.sep}`)) { issues.push(`资料文件 ${file.id} 的路径越界`); continue; }
    const fileStat = await stat(absolute).catch(() => null);
    if (!fileStat?.isFile()) issues.push(`资料文件 ${file.id} 在私有存储中不存在`);
    else if (fileStat.size !== file.fileSize) issues.push(`资料文件 ${file.id} 的数据库大小与磁盘不一致`);
    if (file.previewEnabled) {
      if (file.format !== "PDF") issues.push(`资料文件 ${file.id} 为非 PDF 却开启了试读`);
      if (!file.previewPageStart || !file.previewPageEnd || file.previewPageStart > file.previewPageEnd) issues.push(`资料文件 ${file.id} 的试读页范围无效`);
      if (file.pageCount && file.previewPageEnd && file.previewPageEnd > file.pageCount) issues.push(`资料文件 ${file.id} 的试读页超出总页数`);
    }
  }
  for (const event of accessEvents) {
    if (event.file && event.file.version.profile.itemId !== event.itemId) issues.push(`访问事件 ${event.id} 的资料与文件不一致`);
    if (event.access && (event.access.userId !== event.userId || event.access.orderId !== event.orderId)) issues.push(`访问事件 ${event.id} 与访问授权不一致`);
    if (event.watermarkCode && !["online_preview", "download"].includes(event.action)) issues.push(`访问事件 ${event.id} 的水印动作无效`);
  }
  for (const rating of ratings) {
    if (rating.commerceOrder.status !== "completed") issues.push(`已发布评价 ${rating.id} 关联了非完成订单`);
    if (rating.itemId !== rating.commerceOrder.order.itemId || rating.buyerId !== rating.commerceOrder.order.buyerId || rating.creatorId !== rating.commerceOrder.order.sellerId) issues.push(`评价 ${rating.id} 与订单参与方不一致`);
    if (rating.overall < 1 || rating.overall > 5) issues.push(`评价 ${rating.id} 的综合分无效`);
  }
  for (const issue of orderIssues) {
    if (!issue.slaDueAt) issues.push(`进行中售后 ${issue.id} 缺少 SLA 时限`);
    if (!issue.messages.length) issues.push(`进行中售后 ${issue.id} 缺少证据链首条消息`);
  }
  for (const profile of creatorProfiles) {
    if (profile.qualityScore < 0 || profile.qualityScore > 100) issues.push(`创作者档案 ${profile.id} 的质量分无效`);
    if (profile.averageRatingBps < 0 || profile.averageRatingBps > 500) issues.push(`创作者档案 ${profile.id} 的评分无效`);
    if (profile.refundRateBps < 0 || profile.refundRateBps > 10000 || profile.disputeRateBps < 0 || profile.disputeRateBps > 10000) issues.push(`创作者档案 ${profile.id} 的风险率无效`);
  }
  for (const access of accesses) {
    if (access.userId !== access.order.buyerId) issues.push(`资料访问授权 ${access.id} 与订单买家不一致`);
    if (access.order.itemId !== access.version.profile.itemId) issues.push(`资料访问授权 ${access.id} 的版本不属于订单商品`);
    if (!["paid", "delivering", "completed", "refund_pending", "disputed"].includes(access.order.status)) issues.push(`资料访问授权 ${access.id} 关联了不可访问状态订单`);
  }
  for (const ticket of supportTickets) {
    if (ticket.order.item.category !== "digital_goods") issues.push(`资料售后 ${ticket.id} 关联了非资料商品`);
    if (ticket.buyerId !== ticket.order.buyerId || ticket.sellerId !== ticket.order.sellerId) issues.push(`资料售后 ${ticket.id} 的参与者与订单不一致`);
  }
  if (config?.commissionBps !== 0) issues.push("实体商品基础佣金必须固定为 0");
  if (!config || config.learningMaterialCommissionBps < 0 || config.learningMaterialCommissionBps > 5000) issues.push("学习资料平台服务费配置无效");

  const report = { ok: issues.length === 0, counts: { activeItems: activeItems.length, profiles: profiles.length, activeVersions: activeVersions.length, files: files.length, accesses: accesses.length, accessEvents: accessEvents.length, ratings: ratings.length, activeIssues: orderIssues.length, creatorProfiles: creatorProfiles.length, supportTickets: supportTickets.length }, issues };
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
