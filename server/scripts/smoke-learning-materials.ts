import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import { prisma } from "../src/prisma";
import { signToken } from "../src/utils/jwt";
import { PDFDocument } from "pdf-lib";

const baseUrl = String(process.env.MATERIALS_SMOKE_URL || "http://127.0.0.1:3011/api").replace(/\/$/, "");
const runId = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
const smokeTitle = `付费学习资料全链路冒烟测试 ${runId}`;
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

async function createSmokePdf() {
  const document = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) {
    const page = document.addPage([480, 680]);
    page.drawText(`Kaopu paid learning materials smoke page ${index + 1}`, { x: 30, y: 620, size: 16 });
  }
  return Buffer.from(await document.save());
}

type SmokeUser = {
  id: number;
  username: string;
  role: string;
};

function tokenFor(user: SmokeUser) {
  return signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });
}

async function apiCall(
  token: string,
  apiPath: string,
  init: RequestInit = {},
  expectedStatus = 200,
) {
  const hasBody = init.body !== undefined;
  const response = await fetch(`${baseUrl}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json() as { code: number; data: any; message: string };
  assert.equal(
    response.status,
    expectedStatus,
    `${init.method || "GET"} ${apiPath}: HTTP ${response.status} ${body?.message || ""}`,
  );
  if (expectedStatus >= 200 && expectedStatus < 300) {
    assert.equal(body.code, 0, `${apiPath}: ${body?.message || "接口失败"}`);
    return body.data;
  }
  assert.notEqual(body.code, 0, `${apiPath}: 失败响应缺少错误码`);
  return body;
}

function idempotencyHeaders(key: string) {
  return { "Idempotency-Key": `${key}-${runId}` };
}

async function uploadImage(
  token: string,
  apiPath: string,
  fields: Record<string, string>,
  idempotencyKey?: string,
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("image", new Blob([pngBytes], { type: "image/png" }), "smoke-proof.png");
  return apiCall(token, apiPath, {
    method: "POST",
    headers: idempotencyKey ? idempotencyHeaders(idempotencyKey) : undefined,
    body: form,
  });
}

async function cleanup(userIds: number[], itemId: number) {
  if (itemId) {
    const item = await prisma.marketItem.findUnique({
      where: { id: itemId },
      select: { learningMaterial: { select: { id: true } } },
    });
    await prisma.marketOrder.deleteMany({ where: { itemId } });
    await prisma.marketItem.deleteMany({ where: { id: itemId } });
    if (item?.learningMaterial?.id) {
      const materialRoot = path.resolve(process.cwd(), "runtime", "learning-materials");
      const target = path.resolve(materialRoot, String(item.learningMaterial.id));
      if (target.startsWith(`${materialRoot}${path.sep}`)) {
        await rm(target, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
  if (userIds.length) {
    await prisma.learningCollectionMethod.deleteMany({ where: { creatorId: { in: userIds } } });
    await prisma.learningPrivateAsset.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.learningCreatorApplication.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.learningCreatorProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const assetRoot = path.resolve(process.cwd(), "runtime", "learning-commerce-assets");
    for (const userId of userIds) {
      const target = path.resolve(assetRoot, String(userId));
      if (target.startsWith(`${assetRoot}${path.sep}`)) {
        await rm(target, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "admin", status: "active" },
    orderBy: { id: "asc" },
  });
  assert(admin, "需要一个有效管理员账号运行付费学习资料冒烟测试");

  const createdUsers = await Promise.all([
    prisma.user.create({
      data: {
        username: `learning_seller_${runId}`,
        passwordHash: "smoke-not-used",
        nickname: "冒烟测试创作者",
        role: "user",
        status: "active",
        studentSso: true,
        forumEnabled: true,
      },
    }),
    prisma.user.create({
      data: {
        username: `learning_buyer_${runId}`,
        passwordHash: "smoke-not-used",
        nickname: "冒烟测试买家",
        role: "user",
        status: "active",
        studentSso: true,
        forumEnabled: true,
      },
    }),
    prisma.user.create({
      data: {
        username: `learning_refund_${runId}`,
        passwordHash: "smoke-not-used",
        nickname: "冒烟测试退款买家",
        role: "user",
        status: "active",
        studentSso: true,
        forumEnabled: true,
      },
    }),
    prisma.user.create({
      data: {
        username: `learning_outsider_${runId}`,
        passwordHash: "smoke-not-used",
        nickname: "冒烟测试无关用户",
        role: "user",
        status: "active",
        studentSso: true,
        forumEnabled: true,
      },
    }),
  ]);
  const [seller, buyer, refundBuyer, outsider] = createdUsers;
  const userIds = createdUsers.map((user) => user.id);
  const sellerToken = tokenFor(seller);
  const buyerToken = tokenFor(buyer);
  const refundBuyerToken = tokenFor(refundBuyer);
  const outsiderToken = tokenFor(outsider);
  const adminToken = tokenFor(admin);
  let itemId = 0;

  try {
    const meta = await apiCall(sellerToken, "/market/materials/meta");
    assert.equal(meta.semesters.length, 8);
    assert.equal(meta.commerce.paidEnabled, true);
    assert(meta.commerce.minPrice > 0);
    const approvedType = meta.types.find((row: any) => row.status === "approved" && row.enabled);
    assert(approvedType, "需要至少一个已启用的资料类型");

    const application = await apiCall(sellerToken, "/market/materials/commerce/creator/applications", {
      method: "POST",
      body: JSON.stringify({
        expertise: "计算机课程复习",
        experience: "长期独立整理课程笔记、章节索引和自测清单。",
        sampleDescription: "样例包括课程结构、重点概念、复习节奏与原创练习。",
        rightsCommitted: true,
      }),
    });
    assert.equal(application.status, "submitted");
    const approvedApplication = await apiCall(
      adminToken,
      `/market/materials/commerce/admin/creator-applications/${application.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", reason: "冒烟测试资质核验通过" }),
      },
    );
    assert.equal(approvedApplication.status, "approved");

    const collectionMethod = await uploadImage(
      sellerToken,
      "/market/materials/commerce/creator/collection-methods",
      { provider: "alipay", label: "冒烟测试支付宝收款码" },
    );
    assert.equal(collectionMethod.status, "active");

    const created = await apiCall(sellerToken, "/market/materials/items", {
      method: "POST",
      body: JSON.stringify({
        title: smokeTitle,
        description: "用于核验创作者审核、资料审核、直接收款、付款凭证、交付、售后、退款和权限撤销的完整流程。",
        price: 9.9,
        originalPrice: 19.9,
        images: [],
        draft: true,
        profile: {
          courseCode: "SMOKE101",
          applicableSemester: "Y1S1",
          typeId: approvedType.id,
          fileFormats: ["PDF"],
          pageCount: 4,
          versionLabel: "v1.0 smoke",
          language: "zh-CN",
          originalityKind: "original",
          originalityStatement: "冒烟测试现场生成的原创文本资料。",
          rightsConfirmed: true,
        },
      }),
    });
    itemId = created.id;
    assert.equal(created.status, "draft");
    assert.equal(created.priceCents, 990);

    const versionForm = new FormData();
    const smokePdf = await createSmokePdf();
    versionForm.append("files", new Blob([smokePdf], { type: "application/pdf" }), "smoke-notes.pdf");
    versionForm.append("label", "v1.0 smoke");
    versionForm.append("releaseNotes", "付费学习资料迭代一全链路冒烟测试");
    versionForm.append("previewRanges", JSON.stringify([{ start: 1, end: 2 }]));
    const version = await apiCall(sellerToken, `/market/materials/items/${itemId}/versions`, {
      method: "POST",
      body: versionForm,
    });
    assert.equal(version.files.length, 1);

    const review = await apiCall(
      sellerToken,
      `/market/materials/commerce/items/${itemId}/versions/${version.id}/reviews`,
      { method: "POST", body: "{}" },
    );
    assert.equal(review.status, "submitted");
    const reviewQueue = await apiCall(adminToken, "/market/materials/commerce/admin/material-reviews?status=submitted");
    assert(reviewQueue.some((row: any) => row.id === review.id));
    const approvedReview = await apiCall(
      adminToken,
      `/market/materials/commerce/admin/material-reviews/${review.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          action: "approve",
          reason: "冒烟测试三项人工检查通过",
          checklist: { rights: true, quality: true, fileSafety: true },
        }),
      },
    );
    assert.equal(approvedReview.status, "approved");

    const publicItems = await apiCall(outsiderToken, "/market/materials/items?courseCode=SMOKE101");
    assert(publicItems.list.some((row: any) => row.id === itemId));
    const sampleResponse = await fetch(`${baseUrl}/market/materials/items/${itemId}/files/${version.files[0].id}/sample`);
    assert.equal(sampleResponse.status, 200);
    assert.equal((await PDFDocument.load(await sampleResponse.arrayBuffer())).getPageCount(), 2);

    const orderKey = `create-order-${runId}`;
    const order = await apiCall(buyerToken, `/market/materials/commerce/items/${itemId}/orders`, {
      method: "POST",
      headers: { "Idempotency-Key": orderKey },
      body: JSON.stringify({ provider: "alipay" }),
    });
    const sameOrder = await apiCall(buyerToken, `/market/materials/commerce/items/${itemId}/orders`, {
      method: "POST",
      headers: { "Idempotency-Key": orderKey },
      body: JSON.stringify({ provider: "alipay" }),
    });
    assert.equal(sameOrder.id, order.id, "同一幂等键必须返回同一订单");
    assert.equal(order.status, "pending_payment");
    assert(order.collectionMethod.qrImageUrl);
    await apiCall(
      outsiderToken,
      order.collectionMethod.qrImageUrl.replace(/^\/api/, ""),
      {},
      403,
    );

    const evidenceOrder = await uploadImage(
      buyerToken,
      `/market/materials/commerce/orders/${order.id}/payment-evidence`,
      { claimedPaidAt: new Date().toISOString(), buyerNote: "冒烟测试已付款" },
      "payment-evidence",
    );
    assert.equal(evidenceOrder.status, "awaiting_seller_confirmation");
    const evidence = evidenceOrder.paymentEvidence[0];
    assert.equal(evidence.status, "submitted");
    const sellerOrder = await apiCall(sellerToken, `/market/materials/commerce/orders/${order.id}`);
    assert(sellerOrder.paymentEvidence[0].imageUrl);

    const delivered = await apiCall(
      sellerToken,
      `/market/materials/commerce/orders/${order.id}/payment-evidence/${evidence.id}/confirm`,
      { method: "POST", headers: idempotencyHeaders("confirm-evidence"), body: "{}" },
    );
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.version.files.length, 1);

    const issue = await apiCall(buyerToken, `/market/materials/commerce/orders/${order.id}/issues`, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        reason: "测试售后完成门禁",
        detail: "售后未结案时不允许买家确认完成订单。",
      }),
    });
    const issueMessage = await uploadImage(
      buyerToken,
      `/market/materials/commerce/orders/${order.id}/issues/${issue.id}/messages`,
      { content: "补充上传问题截图作为证据。", attachmentKind: "dispute_attachment" },
    );
    assert.equal(issueMessage.attachment.kind, "dispute_attachment");
    await apiCall(
      buyerToken,
      `/market/materials/commerce/orders/${order.id}/complete`,
      { method: "POST", headers: idempotencyHeaders("blocked-complete"), body: "{}" },
      409,
    );
    const activeIssues = await apiCall(adminToken, "/market/materials/commerce/admin/issues?status=active");
    assert(activeIssues.some((row: any) => row.id === issue.id));
    const issueResolvedOrder = await apiCall(
      adminToken,
      `/market/materials/commerce/admin/orders/${order.id}/issues/${issue.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "resolve", resolution: "已核验资料内容，问题完成处理。", responsibility: "no_fault" }),
      },
    );
    assert.equal(issueResolvedOrder.issues.find((row: any) => row.id === issue.id)?.status, "resolved");

    const completed = await apiCall(
      buyerToken,
      `/market/materials/commerce/orders/${order.id}/complete`,
      { method: "POST", headers: idempotencyHeaders("complete-order"), body: "{}" },
    );
    assert.equal(completed.status, "completed");
    const rating = await apiCall(buyerToken, `/market/materials/commerce/orders/${order.id}/rating`, {
      method: "PUT",
      body: JSON.stringify({
        accuracy: 5,
        usefulness: 5,
        descriptionMatch: 5,
        fileQuality: 5,
        content: "冒烟测试已购评价。",
      }),
    });
    assert.equal(rating.status, "published");
    const download = await fetch(
      `${baseUrl}/market/materials/files/${completed.version.files[0].id}/download`,
      { headers: { Authorization: `Bearer ${buyerToken}` } },
    );
    assert.equal(download.status, 200);
    assert.equal((await PDFDocument.load(await download.arrayBuffer())).getPageCount(), 4);
    const accessAudit = await prisma.learningMaterialAccessEvent.findFirst({
      where: { orderId: completed.orderId, fileId: completed.version.files[0].id, action: "download" },
    });
    assert(accessAudit?.watermarkCode, "买家 PDF 下载必须写入水印追踪码和访问日志");

    const refundOrder = await apiCall(
      refundBuyerToken,
      `/market/materials/commerce/items/${itemId}/orders`,
      {
        method: "POST",
        headers: idempotencyHeaders("refund-order"),
        body: JSON.stringify({ provider: "alipay" }),
      },
    );
    const refundEvidenceOrder = await uploadImage(
      refundBuyerToken,
      `/market/materials/commerce/orders/${refundOrder.id}/payment-evidence`,
      { claimedPaidAt: new Date().toISOString(), buyerNote: "退款链路测试付款" },
      "refund-payment-evidence",
    );
    const refundEvidence = refundEvidenceOrder.paymentEvidence[0];
    const refundDelivered = await apiCall(
      sellerToken,
      `/market/materials/commerce/orders/${refundOrder.id}/payment-evidence/${refundEvidence.id}/confirm`,
      { method: "POST", headers: idempotencyHeaders("refund-confirm"), body: "{}" },
    );
    assert.equal(refundDelivered.status, "delivered");
    const refundIssue = await apiCall(
      refundBuyerToken,
      `/market/materials/commerce/orders/${refundOrder.id}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "refund",
          reason: "测试线下退款登记",
          detail: "核验退款终态和资料访问权撤销。",
        }),
      },
    );
    const refundProofMessage = await uploadImage(
      adminToken,
      `/market/materials/commerce/orders/${refundOrder.id}/issues/${refundIssue.id}/messages`,
      { content: "运营核验：线下退款凭证。", attachmentKind: "refund_evidence" },
    );
    assert.equal(refundProofMessage.attachment.kind, "refund_evidence");
    const refunded = await apiCall(
      adminToken,
      `/market/materials/commerce/admin/orders/${refundOrder.id}/issues/${refundIssue.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          action: "record_refund",
          resolution: "已核验线下全额退款完成。",
          refundAmountCents: 990,
          responsibility: "creator",
        }),
      },
    );
    assert.equal(refunded.status, "refunded");
    assert.equal(refunded.issues.find((row: any) => row.id === refundIssue.id)?.status, "refund_recorded");
    const revokedDownload = await fetch(
      `${baseUrl}/market/materials/files/${refundDelivered.version.files[0].id}/download`,
      { headers: { Authorization: `Bearer ${refundBuyerToken}` } },
    );
    assert.equal(revokedDownload.status, 403, "退款后必须撤销资料下载权限");

    console.log(JSON.stringify({
      ok: true,
      checks: [
        "creator-review",
        "private-collection-qr",
        "paid-price",
        "private-version-upload",
        "real-pdf-sample",
        "licensed-pdf-watermark",
        "per-access-audit",
        "material-review",
        "public-listing",
        "idempotent-order",
        "private-qr-authorization",
        "payment-evidence",
        "verified-purchase-rating",
        "issue-evidence-chain",
        "seller-confirmation",
        "delivery-access",
        "issue-completion-guard",
        "admin-issue-resolution",
        "buyer-completion",
        "authorized-download",
        "refund-record",
        "refunded-terminal-state",
        "access-revocation",
      ],
    }));
  } finally {
    await cleanup(userIds, itemId).catch((error) => {
      console.error("冒烟测试数据清理失败", error);
    });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
