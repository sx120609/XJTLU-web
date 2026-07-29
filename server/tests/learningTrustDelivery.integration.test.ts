import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "learning-trust-delivery-integration-secret";

test("iteration 2 real routes preserve rating, aftersales, refund and creator-governance invariants", async (t) => {
  const express = (await import("express")).default;
  const { router } = await import("../src/routes");
  const { errorHandler } = await import("../src/middleware/error");
  const { signToken } = await import("../src/utils/jwt");
  const { prisma } = await import("../src/prisma");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
  const users = await Promise.all([
    ["creator", "user"],
    ["buyer", "user"],
    ["operator", "admin"],
  ].map(([label, role]) => prisma.user.create({
    data: {
      username: `learning_v2_${label}_${suffix}`,
      passwordHash: "not-used",
      nickname: `Iteration 2 ${label} ${suffix}`,
      role,
      studentSso: true,
      forumEnabled: true,
      aiReviewWhitelisted: true,
      dataAuthAgreedAt: new Date(),
    },
  })));
  const [creator, buyer, operator] = users;
  const userIds = users.map((user) => user.id);

  t.after(async () => {
    const items = await prisma.marketItem.findMany({
      where: { sellerId: creator.id },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    const orders = await prisma.marketOrder.findMany({
      where: {
        OR: [
          { buyerId: { in: userIds } },
          { sellerId: { in: userIds } },
        ],
      },
      select: { id: true },
    });
    const orderIds = orders.map((order) => order.id);
    const commerceOrders = orderIds.length
      ? await prisma.learningCommerceOrder.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      })
      : [];
    const commerceOrderIds = commerceOrders.map((order) => order.id);

    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminActionLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.learningCreatorAppeal.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { handledById: { in: userIds } },
        ],
      },
    });
    await prisma.learningCreatorViolation.deleteMany({
      where: {
        OR: [
          { creatorId: { in: userIds } },
          { createdById: { in: userIds } },
        ],
      },
    });
    if (commerceOrderIds.length) {
      await prisma.learningOrderIssue.deleteMany({
        where: { commerceOrderId: { in: commerceOrderIds } },
      });
      await prisma.learningMaterialRating.deleteMany({
        where: { commerceOrderId: { in: commerceOrderIds } },
      });
    }
    if (orderIds.length || itemIds.length) {
      await prisma.learningMaterialAccessEvent.deleteMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
            ...(itemIds.length ? [{ itemId: { in: itemIds } }] : []),
          ],
        },
      });
    }
    await prisma.learningMaterialAccess.deleteMany({ where: { userId: { in: userIds } } });
    if (commerceOrderIds.length) {
      await prisma.learningCommerceOrder.deleteMany({
        where: { id: { in: commerceOrderIds } },
      });
    }
    if (orderIds.length) {
      await prisma.marketOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (itemIds.length) {
      await prisma.marketItem.deleteMany({ where: { id: { in: itemIds } } });
    }
    await prisma.learningCreatorProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  await prisma.learningCreatorProfile.create({
    data: {
      userId: creator.id,
      status: "active",
      certifiedById: operator.id,
      certifiedAt: new Date(),
    },
  });
  const item = await prisma.marketItem.create({
    data: {
      sellerId: creator.id,
      title: `Iteration 2 learning material ${suffix}`,
      description: "A paid PDF learning material used by the trust and delivery integration test.",
      category: "digital_goods",
      deliveryType: "digital",
      priceCents: 990,
      tradeMode: "online",
      status: "active",
    },
  });
  const material = await prisma.learningMaterialProfile.create({
    data: {
      itemId: item.id,
      courseCode: "INT2002",
      applicableSemester: "2026-S1",
      declaredFormats: "[\"pdf\"]",
      rightsConfirmedAt: new Date(),
      commerceMode: "paid",
    },
  });
  const version = await prisma.learningMaterialVersion.create({
    data: {
      profileId: material.id,
      versionNumber: 1,
      label: "v1",
      status: "active",
      createdById: creator.id,
      publishedAt: new Date(),
    },
  });
  await prisma.learningMaterialProfile.update({
    where: { id: material.id },
    data: { activeVersionId: version.id },
  });
  const marketOrder = await prisma.marketOrder.create({
    data: {
      itemId: item.id,
      buyerId: buyer.id,
      sellerId: creator.id,
      outTradeNo: `LEARNING-V2-${suffix}`,
      amountCents: 990,
      sellerAmountCents: 990,
      deliveryType: "digital",
      status: "completed",
      paidAt: new Date(),
      completedAt: new Date(),
    },
  });
  const commerceOrder = await prisma.learningCommerceOrder.create({
    data: {
      orderId: marketOrder.id,
      versionId: version.id,
      status: "completed",
      priceCents: 990,
      deliveredAt: new Date(),
      completedAt: new Date(),
    },
  });
  const access = await prisma.learningMaterialAccess.create({
    data: {
      orderId: marketOrder.id,
      versionId: version.id,
      userId: buyer.id,
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const token = (user: typeof creator) => signToken({
    userId: user.id,
    studentId: user.username,
    role: user.role,
    campus: "SIP",
  });
  const creatorToken = token(creator);
  const buyerToken = token(buyer);
  const operatorToken = token(operator);

  async function call(
    path: string,
    bearer?: string,
    method = "GET",
    payload?: unknown,
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await response.json() as { code: number; data: any; message: string };
    return { response, body };
  }

  async function api(
    path: string,
    bearer?: string,
    method = "GET",
    payload?: unknown,
  ) {
    const result = await call(path, bearer, method, payload);
    assert.equal(result.response.status, 200, `${method} ${path}: ${result.body.message}`);
    assert.equal(result.body.code, 0, `${method} ${path}: ${result.body.message}`);
    return result.body.data;
  }

  const rating = await api(
    `/market/materials/commerce/orders/${commerceOrder.id}/rating`,
    buyerToken,
    "PUT",
    {
      accuracy: 5,
      usefulness: 5,
      descriptionMatch: 5,
      fileQuality: 5,
      content: "Clear, accurate and useful course notes.",
    },
  );
  assert.equal(rating.status, "published");
  assert.equal(rating.overall, 5);
  const publishedRatings = await api(`/market/materials/items/${item.id}/ratings`);
  assert.equal(publishedRatings.summary.count, 1);
  assert.equal(publishedRatings.summary.overall, 5);
  const ratedProfile = await prisma.learningCreatorProfile.findUniqueOrThrow({
    where: { userId: creator.id },
  });
  assert.equal(ratedProfile.ratingCount, 1);
  assert.equal(ratedProfile.averageRatingBps, 500);

  const issue = await api(
    `/market/materials/commerce/orders/${commerceOrder.id}/issues`,
    buyerToken,
    "POST",
    {
      type: "refund",
      reason: "Material mismatch",
      detail: "The delivered material does not match the published course description.",
    },
  );
  assert.equal(issue.status, "refund_requested");
  assert.ok(issue.slaDueAt);
  assert.equal(
    await prisma.learningOrderIssueMessage.count({ where: { issueId: issue.id } }),
    1,
  );

  const claimed = await api(
    `/market/materials/commerce/admin/orders/${commerceOrder.id}/issues/${issue.id}/claim`,
    operatorToken,
    "POST",
  );
  assert.equal(claimed.issues[0].assignedToId, operator.id);
  const claimedIssue = await prisma.learningOrderIssue.findUniqueOrThrow({
    where: { id: issue.id },
  });
  assert.equal(claimedIssue.assignedToId, operator.id);
  assert.equal(claimedIssue.firstRespondedAt, null);

  const staffMessageForm = new FormData();
  staffMessageForm.append("content", "The evidence has been received and is under review.");
  staffMessageForm.append("attachmentKind", "dispute_attachment");
  const staffMessageResponse = await fetch(
    `${baseUrl}/market/materials/commerce/orders/${commerceOrder.id}/issues/${issue.id}/messages`,
    {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${operatorToken}` },
      body: staffMessageForm,
    },
  );
  const staffMessageBody = await staffMessageResponse.json() as {
    code: number;
    data: any;
    message: string;
  };
  assert.equal(staffMessageResponse.status, 200, staffMessageBody.message);
  assert.equal(staffMessageBody.code, 0, staffMessageBody.message);
  assert.equal(staffMessageBody.data.kind, "staff");
  const respondedIssue = await prisma.learningOrderIssue.findUniqueOrThrow({
    where: { id: issue.id },
  });
  assert.ok(respondedIssue.firstRespondedAt);
  assert.equal(respondedIssue.slaDueAt?.getTime(), claimedIssue.slaDueAt?.getTime());

  const operationsBeforeRefund = await api(
    "/market/materials/commerce/admin/operations",
    operatorToken,
  );
  assert.ok(operationsBeforeRefund.queues.orderIssues.pending >= 1);
  assert.ok(operationsBeforeRefund.funnel30d.ratings >= 1);

  const refunded = await api(
    `/market/materials/commerce/admin/orders/${commerceOrder.id}/issues/${issue.id}`,
    operatorToken,
    "PATCH",
    {
      action: "record_refund",
      resolution: "Full refund recorded after reviewing the buyer claim.",
      refundAmountCents: 990,
      responsibility: "creator",
      refundEvidenceUnavailable: "Refund was handled offline and the original receipt is unavailable.",
    },
  );
  assert.equal(refunded.status, "refunded");
  const [refundedIssue, excludedRating, revokedAccess, refundedProfile] = await Promise.all([
    prisma.learningOrderIssue.findUniqueOrThrow({ where: { id: issue.id } }),
    prisma.learningMaterialRating.findUniqueOrThrow({
      where: { commerceOrderId: commerceOrder.id },
    }),
    prisma.learningMaterialAccess.findUniqueOrThrow({ where: { id: access.id } }),
    prisma.learningCreatorProfile.findUniqueOrThrow({ where: { userId: creator.id } }),
  ]);
  assert.equal(refundedIssue.status, "refund_recorded");
  assert.equal(refundedIssue.responsibility, "creator");
  assert.match(refundedIssue.refundEvidenceUnavailable, /unavailable/i);
  assert.equal(excludedRating.status, "excluded");
  assert.ok(revokedAccess.revokedAt);
  assert.equal(refundedProfile.ratingCount, 0);
  assert.equal(refundedProfile.refundRateBps, 10_000);
  assert.equal(refundedProfile.disputeRateBps, 10_000);
  const ratingsAfterRefund = await api(`/market/materials/items/${item.id}/ratings`);
  assert.equal(ratingsAfterRefund.summary.count, 0);

  const violation = await api(
    "/market/materials/commerce/admin/creator-violations",
    operatorToken,
    "POST",
    {
      creatorId: creator.id,
      itemId: item.id,
      commerceOrderId: commerceOrder.id,
      type: "misleading",
      severity: "high",
      action: "suspend_7d",
      reason: "The material description materially overstated the delivered content.",
      evidence: `Integration order ${commerceOrder.id} and issue ${issue.id}`,
    },
  );
  assert.equal(violation.status, "active");
  assert.equal(violation.action, "suspend_7d");
  const suspendedProfile = await prisma.learningCreatorProfile.findUniqueOrThrow({
    where: { userId: creator.id },
  });
  assert.equal(suspendedProfile.status, "suspended");
  const creatorViolations = await api(
    "/market/materials/commerce/creator/violations",
    creatorToken,
  );
  assert.ok(creatorViolations.some((row: any) => row.id === violation.id));

  const appeal = await api(
    `/market/materials/commerce/creator/violations/${violation.id}/appeal`,
    creatorToken,
    "POST",
    {
      content: "The listing has been corrected and supporting source files are available for review.",
    },
  );
  assert.equal(appeal.status, "pending");
  const decidedAppeal = await api(
    `/market/materials/commerce/admin/creator-appeals/${appeal.id}`,
    operatorToken,
    "PATCH",
    {
      action: "approve",
      note: "The correction and source evidence have been verified.",
    },
  );
  assert.equal(decidedAppeal.status, "approved");
  const [revokedViolation, restoredProfile] = await Promise.all([
    prisma.learningCreatorViolation.findUniqueOrThrow({ where: { id: violation.id } }),
    prisma.learningCreatorProfile.findUniqueOrThrow({ where: { userId: creator.id } }),
  ]);
  assert.equal(revokedViolation.status, "revoked");
  assert.ok(revokedViolation.revokedAt);
  assert.equal(restoredProfile.status, "active");
  assert.equal(restoredProfile.statusReason, "");

  const resolvedIssues = await api(
    "/market/materials/commerce/admin/issues?status=resolved",
    operatorToken,
  );
  assert.ok(resolvedIssues.some((row: any) => (
    row.id === issue.id
    && row.assignedToId === operator.id
    && row.responsibility === "creator"
  )));
  const operationsAfterRefund = await api(
    "/market/materials/commerce/admin/operations",
    operatorToken,
  );
  assert.ok(operationsAfterRefund.funnel30d.refunded >= 1);
});
