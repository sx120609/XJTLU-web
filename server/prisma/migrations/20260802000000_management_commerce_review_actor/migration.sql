-- Independent management identities for physical-item and learning-material review.
ALTER TABLE "MarketItem"
  ADD COLUMN "moderatedByAdminId" INTEGER;

ALTER TABLE "LearningMaterialReview"
  ADD COLUMN "reviewedByAdminId" INTEGER;

CREATE INDEX "MarketItem_moderatedByAdminId_moderatedAt_idx"
  ON "MarketItem"("moderatedByAdminId", "moderatedAt");

CREATE INDEX "LearningMaterialReview_reviewedByAdminId_reviewedAt_idx"
  ON "LearningMaterialReview"("reviewedByAdminId", "reviewedAt");

ALTER TABLE "MarketItem"
  ADD CONSTRAINT "MarketItem_moderatedByAdminId_fkey"
  FOREIGN KEY ("moderatedByAdminId") REFERENCES "AdminAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningMaterialReview"
  ADD CONSTRAINT "LearningMaterialReview_reviewedByAdminId_fkey"
  FOREIGN KEY ("reviewedByAdminId") REFERENCES "AdminAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
