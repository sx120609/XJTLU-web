-- Stage 10 keeps platform revenue orders manual while adding capacity, after-service records,
-- merchant re-review reminders, effect snapshots, and operational query indexes.

ALTER TABLE "MerchantProfile"
  ADD COLUMN "reviewDueAt" TIMESTAMP(3),
  ADD COLUMN "reviewReminderSentAt" TIMESTAMP(3);

ALTER TABLE "PromotionPlan"
  ADD COLUMN "manualCostCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxActive" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PromotionOrder"
  ADD COLUMN "manualCostCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inquiryStartCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inquiryEndCount" INTEGER,
  ADD COLUMN "renewalReminderSentAt" TIMESTAMP(3);

CREATE TABLE "PromotionAdjustment" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "actorId" INTEGER,
  "type" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "extensionDays" INTEGER NOT NULL DEFAULT 0,
  "reference" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionAdjustment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PromotionAdjustment"
  ADD CONSTRAINT "PromotionAdjustment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "PromotionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionAdjustment"
  ADD CONSTRAINT "PromotionAdjustment_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TradeIntent_createdAt_idx" ON "TradeIntent"("createdAt");
CREATE INDEX "WantedResponse_createdAt_idx" ON "WantedResponse"("createdAt");
CREATE INDEX "MerchantProfile_status_reviewDueAt_idx" ON "MerchantProfile"("status", "reviewDueAt");
CREATE INDEX "PromotionOrder_paymentMode_confirmedAt_idx" ON "PromotionOrder"("paymentMode", "confirmedAt");
CREATE INDEX "PromotionAdjustment_orderId_createdAt_idx" ON "PromotionAdjustment"("orderId", "createdAt");
CREATE INDEX "PromotionAdjustment_type_createdAt_idx" ON "PromotionAdjustment"("type", "createdAt");
CREATE INDEX "PromotionAdjustment_actorId_createdAt_idx" ON "PromotionAdjustment"("actorId", "createdAt");
CREATE INDEX "LearningMaterialProfile_createdAt_idx" ON "LearningMaterialProfile"("createdAt");
CREATE INDEX "LearningMaterialAccess_grantedAt_idx" ON "LearningMaterialAccess"("grantedAt");
