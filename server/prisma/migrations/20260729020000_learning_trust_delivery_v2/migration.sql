-- 靠浦 V1 迭代二：可信内容、可追溯交付、成交评价和运营治理。
-- 所有变更均为向前兼容扩展；历史资料、订单和访问权不做破坏性改写。

CREATE TYPE "LearningMaterialRatingStatus" AS ENUM ('published', 'hidden', 'excluded');
CREATE TYPE "LearningCreatorViolationStatus" AS ENUM ('active', 'revoked', 'expired');
CREATE TYPE "LearningCreatorAppealStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "LearningMaterialFile"
  ADD COLUMN "previewEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "previewPageStart" INTEGER,
  ADD COLUMN "previewPageEnd" INTEGER;

ALTER TABLE "LearningMaterialFile"
  ADD CONSTRAINT "LearningMaterialFile_preview_pages_check" CHECK (
    ("previewEnabled" = false AND "previewPageStart" IS NULL AND "previewPageEnd" IS NULL)
    OR (
      "previewEnabled" = true
      AND "format" = 'PDF'
      AND "previewPageStart" IS NOT NULL
      AND "previewPageEnd" IS NOT NULL
      AND "previewPageStart" >= 1
      AND "previewPageEnd" >= "previewPageStart"
      AND ("pageCount" IS NULL OR "previewPageEnd" <= "pageCount")
    )
  );

ALTER TABLE "LearningCreatorProfile"
  ADD COLUMN "level" TEXT NOT NULL DEFAULT 'certified',
  ADD COLUMN "qualityScore" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "completedOrderCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "averageRatingBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundRateBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "disputeRateBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "averageConfirmMinutes" INTEGER,
  ADD COLUMN "metricsUpdatedAt" TIMESTAMP(3);

ALTER TABLE "LearningCreatorProfile"
  ADD CONSTRAINT "LearningCreatorProfile_qualityScore_check" CHECK ("qualityScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "LearningCreatorProfile_rating_check" CHECK ("averageRatingBps" BETWEEN 0 AND 500),
  ADD CONSTRAINT "LearningCreatorProfile_refundRate_check" CHECK ("refundRateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "LearningCreatorProfile_disputeRate_check" CHECK ("disputeRateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "LearningCreatorProfile_counts_check" CHECK (
    "completedOrderCount" >= 0
    AND "ratingCount" >= 0
    AND ("averageConfirmMinutes" IS NULL OR "averageConfirmMinutes" >= 0)
  );

ALTER TABLE "LearningOrderIssue"
  ADD COLUMN "responsibility" TEXT NOT NULL DEFAULT 'unassigned',
  ADD COLUMN "slaDueAt" TIMESTAMP(3),
  ADD COLUMN "assignedToId" INTEGER,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "firstRespondedAt" TIMESTAMP(3),
  ADD COLUMN "refundEvidenceUnavailable" TEXT NOT NULL DEFAULT '';

UPDATE "LearningOrderIssue"
SET "slaDueAt" = "createdAt" + INTERVAL '24 hours'
WHERE "resolvedAt" IS NULL;

CREATE TABLE "LearningMaterialAccessEvent" (
  "id" SERIAL NOT NULL,
  "accessId" INTEGER,
  "fileId" INTEGER,
  "userId" INTEGER,
  "orderId" INTEGER,
  "itemId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL DEFAULT 'allowed',
  "watermarkCode" TEXT NOT NULL DEFAULT '',
  "ipHash" TEXT NOT NULL DEFAULT '',
  "clientHash" TEXT NOT NULL DEFAULT '',
  "bytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningMaterialAccessEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningMaterialAccessEvent_bytes_check" CHECK ("bytes" IS NULL OR "bytes" >= 0)
);

CREATE TABLE "LearningOrderIssueMessage" (
  "id" SERIAL NOT NULL,
  "issueId" INTEGER NOT NULL,
  "senderId" INTEGER,
  "kind" TEXT NOT NULL DEFAULT 'user',
  "content" TEXT NOT NULL,
  "attachmentAssetId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningOrderIssueMessage_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LearningOrderIssueMessage" (
  "issueId",
  "senderId",
  "kind",
  "content",
  "createdAt"
)
SELECT
  "id",
  "requestedById",
  'user',
  CASE WHEN "detail" <> '' THEN "detail" ELSE "reason" END,
  "createdAt"
FROM "LearningOrderIssue";

CREATE TABLE "LearningMaterialRating" (
  "id" SERIAL NOT NULL,
  "commerceOrderId" INTEGER NOT NULL,
  "itemId" INTEGER NOT NULL,
  "versionId" INTEGER NOT NULL,
  "buyerId" INTEGER NOT NULL,
  "creatorId" INTEGER NOT NULL,
  "accuracy" INTEGER NOT NULL,
  "usefulness" INTEGER NOT NULL,
  "descriptionMatch" INTEGER NOT NULL,
  "fileQuality" INTEGER NOT NULL,
  "overall" INTEGER NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "status" "LearningMaterialRatingStatus" NOT NULL DEFAULT 'published',
  "moderationReason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningMaterialRating_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningMaterialRating_scores_check" CHECK (
    "accuracy" BETWEEN 1 AND 5
    AND "usefulness" BETWEEN 1 AND 5
    AND "descriptionMatch" BETWEEN 1 AND 5
    AND "fileQuality" BETWEEN 1 AND 5
    AND "overall" BETWEEN 1 AND 5
  )
);

CREATE TABLE "LearningCreatorViolation" (
  "id" SERIAL NOT NULL,
  "creatorId" INTEGER NOT NULL,
  "itemId" INTEGER,
  "commerceOrderId" INTEGER,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" TEXT NOT NULL DEFAULT '',
  "status" "LearningCreatorViolationStatus" NOT NULL DEFAULT 'active',
  "createdById" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningCreatorViolation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningCreatorAppeal" (
  "id" SERIAL NOT NULL,
  "violationId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "status" "LearningCreatorAppealStatus" NOT NULL DEFAULT 'pending',
  "handledById" INTEGER,
  "handleNote" TEXT NOT NULL DEFAULT '',
  "handledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningCreatorAppeal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningOrderIssueMessage_attachmentAssetId_key"
  ON "LearningOrderIssueMessage"("attachmentAssetId");
CREATE UNIQUE INDEX "LearningMaterialRating_commerceOrderId_key"
  ON "LearningMaterialRating"("commerceOrderId");
CREATE UNIQUE INDEX "LearningCreatorAppeal_violationId_userId_key"
  ON "LearningCreatorAppeal"("violationId", "userId");

CREATE INDEX "LearningMaterialAccessEvent_fileId_createdAt_idx"
  ON "LearningMaterialAccessEvent"("fileId", "createdAt");
CREATE INDEX "LearningMaterialAccessEvent_accessId_createdAt_idx"
  ON "LearningMaterialAccessEvent"("accessId", "createdAt");
CREATE INDEX "LearningMaterialAccessEvent_userId_createdAt_idx"
  ON "LearningMaterialAccessEvent"("userId", "createdAt");
CREATE INDEX "LearningMaterialAccessEvent_itemId_action_createdAt_idx"
  ON "LearningMaterialAccessEvent"("itemId", "action", "createdAt");
CREATE INDEX "LearningMaterialAccessEvent_watermarkCode_idx"
  ON "LearningMaterialAccessEvent"("watermarkCode");
CREATE INDEX "LearningOrderIssueMessage_issueId_createdAt_idx"
  ON "LearningOrderIssueMessage"("issueId", "createdAt");
CREATE INDEX "LearningOrderIssueMessage_senderId_createdAt_idx"
  ON "LearningOrderIssueMessage"("senderId", "createdAt");
CREATE INDEX "LearningMaterialRating_itemId_status_createdAt_idx"
  ON "LearningMaterialRating"("itemId", "status", "createdAt");
CREATE INDEX "LearningMaterialRating_creatorId_status_createdAt_idx"
  ON "LearningMaterialRating"("creatorId", "status", "createdAt");
CREATE INDEX "LearningMaterialRating_buyerId_createdAt_idx"
  ON "LearningMaterialRating"("buyerId", "createdAt");
CREATE INDEX "LearningMaterialRating_versionId_status_idx"
  ON "LearningMaterialRating"("versionId", "status");
CREATE INDEX "LearningCreatorViolation_creatorId_status_createdAt_idx"
  ON "LearningCreatorViolation"("creatorId", "status", "createdAt");
CREATE INDEX "LearningCreatorViolation_status_expiresAt_idx"
  ON "LearningCreatorViolation"("status", "expiresAt");
CREATE INDEX "LearningCreatorViolation_createdById_createdAt_idx"
  ON "LearningCreatorViolation"("createdById", "createdAt");
CREATE INDEX "LearningCreatorViolation_itemId_createdAt_idx"
  ON "LearningCreatorViolation"("itemId", "createdAt");
CREATE INDEX "LearningCreatorViolation_commerceOrderId_createdAt_idx"
  ON "LearningCreatorViolation"("commerceOrderId", "createdAt");
CREATE INDEX "LearningCreatorAppeal_status_createdAt_idx"
  ON "LearningCreatorAppeal"("status", "createdAt");
CREATE INDEX "LearningCreatorAppeal_handledById_handledAt_idx"
  ON "LearningCreatorAppeal"("handledById", "handledAt");
CREATE INDEX "LearningOrderIssue_status_slaDueAt_idx"
  ON "LearningOrderIssue"("status", "slaDueAt");
CREATE INDEX "LearningOrderIssue_assignedToId_status_updatedAt_idx"
  ON "LearningOrderIssue"("assignedToId", "status", "updatedAt");

ALTER TABLE "LearningMaterialAccessEvent"
  ADD CONSTRAINT "LearningMaterialAccessEvent_accessId_fkey"
    FOREIGN KEY ("accessId") REFERENCES "LearningMaterialAccess"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialAccessEvent_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "LearningMaterialFile"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialAccessEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialAccessEvent_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningOrderIssue"
  ADD CONSTRAINT "LearningOrderIssue_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningOrderIssueMessage"
  ADD CONSTRAINT "LearningOrderIssueMessage_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "LearningOrderIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningOrderIssueMessage_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningOrderIssueMessage_attachmentAssetId_fkey"
    FOREIGN KEY ("attachmentAssetId") REFERENCES "LearningPrivateAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningMaterialRating"
  ADD CONSTRAINT "LearningMaterialRating_commerceOrderId_fkey"
    FOREIGN KEY ("commerceOrderId") REFERENCES "LearningCommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialRating_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialRating_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialRating_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningMaterialRating_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearningCreatorViolation"
  ADD CONSTRAINT "LearningCreatorViolation_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCreatorViolation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCreatorViolation_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCreatorViolation_commerceOrderId_fkey"
    FOREIGN KEY ("commerceOrderId") REFERENCES "LearningCommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningCreatorAppeal"
  ADD CONSTRAINT "LearningCreatorAppeal_violationId_fkey"
    FOREIGN KEY ("violationId") REFERENCES "LearningCreatorViolation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCreatorAppeal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LearningCreatorAppeal_handledById_fkey"
    FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
