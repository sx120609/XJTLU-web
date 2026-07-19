ALTER TABLE "PromotionOrder"
  ADD COLUMN "verificationMethod" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "verificationReference" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "verifiedAmountCents" INTEGER;

CREATE INDEX "PromotionOrder_paymentMode_status_createdAt_idx"
  ON "PromotionOrder"("paymentMode", "status", "createdAt");
