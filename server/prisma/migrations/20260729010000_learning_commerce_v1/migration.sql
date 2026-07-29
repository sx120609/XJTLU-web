-- 靠浦 V1 付费学习资料交易内核。
-- 本迁移只做扩展和历史标记；不删除旧表、旧列或既有资料访问权。

CREATE TYPE "LearningMaterialCommerceMode" AS ENUM ('legacy_free', 'paid');
CREATE TYPE "LearningCreatorApplicationStatus" AS ENUM ('draft', 'submitted', 'reviewing', 'approved', 'rejected', 'withdrawn');
CREATE TYPE "LearningCreatorStatus" AS ENUM ('active', 'suspended', 'revoked');
CREATE TYPE "LearningMaterialReviewStatus" AS ENUM ('submitted', 'reviewing', 'approved', 'rejected', 'withdrawn');
CREATE TYPE "LearningPrivateAssetKind" AS ENUM ('collection_qr', 'payment_evidence', 'refund_evidence', 'dispute_attachment');
CREATE TYPE "LearningPrivateAssetStatus" AS ENUM ('active', 'blocked', 'removed');
CREATE TYPE "LearningCollectionProvider" AS ENUM ('alipay', 'wechat');
CREATE TYPE "LearningCollectionMethodStatus" AS ENUM ('active', 'disabled', 'rejected');
CREATE TYPE "LearningCommerceOrderStatus" AS ENUM ('pending_payment', 'awaiting_seller_confirmation', 'disputed', 'delivered', 'completed', 'refunded', 'cancelled', 'expired');
CREATE TYPE "LearningPaymentEvidenceStatus" AS ENUM ('submitted', 'accepted', 'rejected', 'superseded');
CREATE TYPE "LearningOrderIssueStatus" AS ENUM ('open', 'waiting_buyer', 'waiting_seller', 'refund_requested', 'refund_recorded', 'resolved', 'closed');
CREATE TYPE "LearningCommerceCommandStatus" AS ENUM ('processing', 'completed', 'failed');

-- The commerce contract is seller-direct: neither physical student trades nor
-- paid learning materials are allowed to create a platform commission.
INSERT INTO "MarketConfig" (
  "id",
  "commissionBps",
  "learningMaterialCommissionBps",
  "createdAt",
  "updatedAt"
)
VALUES (1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
SET
  "commissionBps" = 0,
  "learningMaterialCommissionBps" = 0,
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "LearningMaterialProfile"
  ADD COLUMN "commerceMode" "LearningMaterialCommerceMode" NOT NULL DEFAULT 'paid';

-- 所有升级前资料明确归为历史 0 元内容；历史访问权保留，但不会进入新的付费货架。
UPDATE "LearningMaterialProfile"
SET "commerceMode" = 'legacy_free';

CREATE TABLE "LearningCreatorApplication" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "LearningCreatorApplicationStatus" NOT NULL DEFAULT 'submitted',
  "expertise" TEXT NOT NULL DEFAULT '',
  "experience" TEXT NOT NULL DEFAULT '',
  "sampleDescription" TEXT NOT NULL DEFAULT '',
  "rightsCommitmentAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningCreatorApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningCreatorProfile" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "LearningCreatorStatus" NOT NULL DEFAULT 'active',
  "certifiedById" INTEGER,
  "certifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReviewedAt" TIMESTAMP(3),
  "statusReason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningCreatorProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningPrivateAsset" (
  "id" SERIAL NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "kind" "LearningPrivateAssetKind" NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" "LearningPrivateAssetStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningPrivateAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningPrivateAsset_fileSize_check" CHECK ("fileSize" > 0)
);

CREATE TABLE "LearningCollectionMethod" (
  "id" SERIAL NOT NULL,
  "creatorId" INTEGER NOT NULL,
  "creatorProfileId" INTEGER NOT NULL,
  "provider" "LearningCollectionProvider" NOT NULL,
  "assetId" INTEGER NOT NULL,
  "label" TEXT NOT NULL DEFAULT '',
  "versionNumber" INTEGER NOT NULL,
  "status" "LearningCollectionMethodStatus" NOT NULL DEFAULT 'active',
  "reviewedById" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningCollectionMethod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningCollectionMethod_versionNumber_check" CHECK ("versionNumber" > 0)
);

CREATE TABLE "LearningMaterialReview" (
  "id" SERIAL NOT NULL,
  "versionId" INTEGER NOT NULL,
  "round" INTEGER NOT NULL,
  "status" "LearningMaterialReviewStatus" NOT NULL DEFAULT 'submitted',
  "submittedById" INTEGER NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL DEFAULT '',
  "checklist" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningMaterialReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningMaterialReview_round_check" CHECK ("round" > 0)
);

CREATE TABLE "LearningCommerceOrder" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "versionId" INTEGER NOT NULL,
  "collectionMethodId" INTEGER,
  "mode" "LearningMaterialCommerceMode" NOT NULL DEFAULT 'paid',
  "status" "LearningCommerceOrderStatus" NOT NULL DEFAULT 'pending_payment',
  "statusVersion" INTEGER NOT NULL DEFAULT 0,
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "paymentDueAt" TIMESTAMP(3),
  "sellerResponseDueAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "completionDueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningCommerceOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningCommerceOrder_price_check" CHECK (
    ("mode" = 'legacy_free' AND "priceCents" = 0)
    OR ("mode" = 'paid' AND "priceCents" > 0)
  ),
  CONSTRAINT "LearningCommerceOrder_currency_check" CHECK ("currency" = 'CNY')
);

CREATE TABLE "LearningPaymentEvidence" (
  "id" SERIAL NOT NULL,
  "commerceOrderId" INTEGER NOT NULL,
  "assetId" INTEGER NOT NULL,
  "submittedById" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" "LearningPaymentEvidenceStatus" NOT NULL DEFAULT 'submitted',
  "claimedPaidAt" TIMESTAMP(3),
  "buyerNote" TEXT NOT NULL DEFAULT '',
  "handledById" INTEGER,
  "handledReason" TEXT NOT NULL DEFAULT '',
  "handledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningPaymentEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningPaymentEvidence_attempt_check" CHECK ("attempt" > 0)
);

CREATE TABLE "LearningOrderEvent" (
  "id" SERIAL NOT NULL,
  "commerceOrderId" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "actorId" INTEGER,
  "fromStatus" "LearningCommerceOrderStatus",
  "toStatus" "LearningCommerceOrderStatus",
  "requestId" TEXT NOT NULL DEFAULT '',
  "detail" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningOrderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningOrderEvent_sequence_check" CHECK ("sequence" > 0)
);

CREATE TABLE "LearningOrderIssue" (
  "id" SERIAL NOT NULL,
  "commerceOrderId" INTEGER NOT NULL,
  "requestedById" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "status" "LearningOrderIssueStatus" NOT NULL DEFAULT 'open',
  "reason" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "refundAmountCents" INTEGER,
  "refundAssetId" INTEGER,
  "resolvedById" INTEGER,
  "resolution" TEXT NOT NULL DEFAULT '',
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningOrderIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningOrderIssue_refundAmount_check" CHECK ("refundAmountCents" IS NULL OR "refundAmountCents" >= 0)
);

CREATE TABLE "LearningCommerceCommand" (
  "id" SERIAL NOT NULL,
  "actorId" INTEGER NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "LearningCommerceCommandStatus" NOT NULL DEFAULT 'processing',
  "resourceType" TEXT NOT NULL DEFAULT '',
  "resourceId" TEXT NOT NULL DEFAULT '',
  "responseCode" INTEGER,
  "responseBody" TEXT NOT NULL DEFAULT '',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningCommerceCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningCreatorProfile_userId_key" ON "LearningCreatorProfile"("userId");
CREATE UNIQUE INDEX "LearningPrivateAsset_relativePath_key" ON "LearningPrivateAsset"("relativePath");
CREATE UNIQUE INDEX "LearningCollectionMethod_assetId_key" ON "LearningCollectionMethod"("assetId");
CREATE UNIQUE INDEX "LearningCollectionMethod_creatorId_provider_versionNumber_key" ON "LearningCollectionMethod"("creatorId", "provider", "versionNumber");
CREATE UNIQUE INDEX "LearningMaterialReview_versionId_round_key" ON "LearningMaterialReview"("versionId", "round");
CREATE UNIQUE INDEX "LearningCommerceOrder_orderId_key" ON "LearningCommerceOrder"("orderId");
CREATE UNIQUE INDEX "LearningPaymentEvidence_assetId_key" ON "LearningPaymentEvidence"("assetId");
CREATE UNIQUE INDEX "LearningPaymentEvidence_commerceOrderId_attempt_key" ON "LearningPaymentEvidence"("commerceOrderId", "attempt");
CREATE UNIQUE INDEX "LearningOrderEvent_commerceOrderId_sequence_key" ON "LearningOrderEvent"("commerceOrderId", "sequence");
CREATE UNIQUE INDEX "LearningOrderIssue_refundAssetId_key" ON "LearningOrderIssue"("refundAssetId");
CREATE UNIQUE INDEX "LearningCommerceCommand_actorId_operation_idempotencyKey_key" ON "LearningCommerceCommand"("actorId", "operation", "idempotencyKey");

CREATE UNIQUE INDEX "LearningCreatorApplication_one_pending_per_user"
ON "LearningCreatorApplication"("userId")
WHERE "status" IN ('submitted', 'reviewing');

CREATE UNIQUE INDEX "LearningCollectionMethod_one_active_per_provider"
ON "LearningCollectionMethod"("creatorId", "provider")
WHERE "status" = 'active';

CREATE UNIQUE INDEX "LearningPaymentEvidence_one_submitted_per_order"
ON "LearningPaymentEvidence"("commerceOrderId")
WHERE "status" = 'submitted';

CREATE INDEX "LearningCreatorApplication_userId_status_createdAt_idx" ON "LearningCreatorApplication"("userId", "status", "createdAt");
CREATE INDEX "LearningCreatorApplication_status_submittedAt_idx" ON "LearningCreatorApplication"("status", "submittedAt");
CREATE INDEX "LearningCreatorApplication_reviewedById_reviewedAt_idx" ON "LearningCreatorApplication"("reviewedById", "reviewedAt");
CREATE INDEX "LearningCreatorProfile_status_certifiedAt_idx" ON "LearningCreatorProfile"("status", "certifiedAt");
CREATE INDEX "LearningCreatorProfile_certifiedById_certifiedAt_idx" ON "LearningCreatorProfile"("certifiedById", "certifiedAt");
CREATE INDEX "LearningPrivateAsset_ownerId_kind_status_createdAt_idx" ON "LearningPrivateAsset"("ownerId", "kind", "status", "createdAt");
CREATE INDEX "LearningPrivateAsset_sha256_idx" ON "LearningPrivateAsset"("sha256");
CREATE INDEX "LearningCollectionMethod_creatorId_status_createdAt_idx" ON "LearningCollectionMethod"("creatorId", "status", "createdAt");
CREATE INDEX "LearningCollectionMethod_creatorProfileId_status_idx" ON "LearningCollectionMethod"("creatorProfileId", "status");
CREATE INDEX "LearningCollectionMethod_reviewedById_reviewedAt_idx" ON "LearningCollectionMethod"("reviewedById", "reviewedAt");
CREATE INDEX "LearningMaterialReview_versionId_status_createdAt_idx" ON "LearningMaterialReview"("versionId", "status", "createdAt");
CREATE INDEX "LearningMaterialReview_status_submittedAt_idx" ON "LearningMaterialReview"("status", "submittedAt");
CREATE INDEX "LearningMaterialReview_reviewedById_reviewedAt_idx" ON "LearningMaterialReview"("reviewedById", "reviewedAt");
CREATE INDEX "LearningCommerceOrder_status_paymentDueAt_idx" ON "LearningCommerceOrder"("status", "paymentDueAt");
CREATE INDEX "LearningCommerceOrder_status_sellerResponseDueAt_idx" ON "LearningCommerceOrder"("status", "sellerResponseDueAt");
CREATE INDEX "LearningCommerceOrder_status_completionDueAt_idx" ON "LearningCommerceOrder"("status", "completionDueAt");
CREATE INDEX "LearningCommerceOrder_versionId_status_createdAt_idx" ON "LearningCommerceOrder"("versionId", "status", "createdAt");
CREATE INDEX "LearningCommerceOrder_collectionMethodId_createdAt_idx" ON "LearningCommerceOrder"("collectionMethodId", "createdAt");
CREATE INDEX "LearningPaymentEvidence_commerceOrderId_status_createdAt_idx" ON "LearningPaymentEvidence"("commerceOrderId", "status", "createdAt");
CREATE INDEX "LearningPaymentEvidence_submittedById_createdAt_idx" ON "LearningPaymentEvidence"("submittedById", "createdAt");
CREATE INDEX "LearningPaymentEvidence_handledById_handledAt_idx" ON "LearningPaymentEvidence"("handledById", "handledAt");
CREATE INDEX "LearningOrderEvent_commerceOrderId_createdAt_idx" ON "LearningOrderEvent"("commerceOrderId", "createdAt");
CREATE INDEX "LearningOrderEvent_type_createdAt_idx" ON "LearningOrderEvent"("type", "createdAt");
CREATE INDEX "LearningOrderEvent_actorId_createdAt_idx" ON "LearningOrderEvent"("actorId", "createdAt");
CREATE INDEX "LearningOrderIssue_commerceOrderId_status_createdAt_idx" ON "LearningOrderIssue"("commerceOrderId", "status", "createdAt");
CREATE INDEX "LearningOrderIssue_status_createdAt_idx" ON "LearningOrderIssue"("status", "createdAt");
CREATE INDEX "LearningOrderIssue_requestedById_createdAt_idx" ON "LearningOrderIssue"("requestedById", "createdAt");
CREATE INDEX "LearningOrderIssue_resolvedById_resolvedAt_idx" ON "LearningOrderIssue"("resolvedById", "resolvedAt");
CREATE INDEX "LearningCommerceCommand_status_expiresAt_idx" ON "LearningCommerceCommand"("status", "expiresAt");
CREATE INDEX "LearningCommerceCommand_resourceType_resourceId_createdAt_idx" ON "LearningCommerceCommand"("resourceType", "resourceId", "createdAt");

ALTER TABLE "LearningCreatorApplication"
  ADD CONSTRAINT "LearningCreatorApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCreatorApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningCreatorProfile"
  ADD CONSTRAINT "LearningCreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCreatorProfile_certifiedById_fkey" FOREIGN KEY ("certifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningPrivateAsset"
  ADD CONSTRAINT "LearningPrivateAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningCollectionMethod"
  ADD CONSTRAINT "LearningCollectionMethod_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCollectionMethod_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "LearningCreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCollectionMethod_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LearningPrivateAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCollectionMethod_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningMaterialReview"
  ADD CONSTRAINT "LearningMaterialReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialReview_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningCommerceOrder"
  ADD CONSTRAINT "LearningCommerceOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCommerceOrder_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCommerceOrder_collectionMethodId_fkey" FOREIGN KEY ("collectionMethodId") REFERENCES "LearningCollectionMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningPaymentEvidence"
  ADD CONSTRAINT "LearningPaymentEvidence_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "LearningCommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningPaymentEvidence_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "LearningPrivateAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningPaymentEvidence_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningPaymentEvidence_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningOrderEvent"
  ADD CONSTRAINT "LearningOrderEvent_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "LearningCommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningOrderEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningOrderIssue"
  ADD CONSTRAINT "LearningOrderIssue_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "LearningCommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningOrderIssue_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningOrderIssue_refundAssetId_fkey" FOREIGN KEY ("refundAssetId") REFERENCES "LearningPrivateAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningOrderIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningCommerceCommand"
  ADD CONSTRAINT "LearningCommerceCommand_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 历史已领取 0 元资料生成兼容订单扩展；不改变原 MarketOrder 和访问权。
INSERT INTO "LearningCommerceOrder" (
  "orderId",
  "versionId",
  "collectionMethodId",
  "mode",
  "status",
  "statusVersion",
  "priceCents",
  "currency",
  "deliveredAt",
  "completedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  o."id",
  a."versionId",
  NULL,
  'legacy_free',
  'completed',
  1,
  0,
  'CNY',
  COALESCE(o."digitalDeliveredAt", a."grantedAt", o."createdAt"),
  COALESCE(o."completedAt", a."grantedAt", o."createdAt"),
  o."createdAt",
  CURRENT_TIMESTAMP
FROM "MarketOrder" o
JOIN "LearningMaterialAccess" a ON a."orderId" = o."id"
WHERE o."deliveryType" = 'digital'
  AND o."amountCents" = 0
ON CONFLICT ("orderId") DO NOTHING;

INSERT INTO "LearningOrderEvent" (
  "commerceOrderId",
  "sequence",
  "type",
  "fromStatus",
  "toStatus",
  "detail",
  "createdAt"
)
SELECT
  c."id",
  1,
  'LEGACY_FREE_ACCESS_MIGRATED',
  NULL,
  'completed',
  '{"migration":"20260729010000_learning_commerce_v1"}',
  c."createdAt"
FROM "LearningCommerceOrder" c
WHERE c."mode" = 'legacy_free'
ON CONFLICT ("commerceOrderId", "sequence") DO NOTHING;

UPDATE "MarketCategory"
SET
  "name" = '付费学习资料',
  "description" = '通过创作者认证和人工审核的校园学习资料；平台记录付款凭证并在卖家确认后自动交付',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'digital_goods';
