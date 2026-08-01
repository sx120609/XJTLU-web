-- Keep personal-user reviewers and independent management-account reviewers distinct.
ALTER TABLE "Topic"
  ADD COLUMN "manualReviewedByAdminId" INTEGER;

ALTER TABLE "Reply"
  ADD COLUMN "manualReviewedByAdminId" INTEGER;

ALTER TABLE "ForumImageAsset"
  ADD COLUMN "manualReviewedByAdminId" INTEGER;

ALTER TABLE "ForumVideoAsset"
  ADD COLUMN "manualReviewedByAdminId" INTEGER;

CREATE INDEX "Topic_manualReviewedByAdminId_idx"
  ON "Topic"("manualReviewedByAdminId");

CREATE INDEX "Reply_manualReviewedByAdminId_idx"
  ON "Reply"("manualReviewedByAdminId");

CREATE INDEX "ForumImageAsset_manualReviewedByAdminId_idx"
  ON "ForumImageAsset"("manualReviewedByAdminId");

CREATE INDEX "ForumVideoAsset_manualReviewedByAdminId_idx"
  ON "ForumVideoAsset"("manualReviewedByAdminId");

ALTER TABLE "Topic"
  ADD CONSTRAINT "Topic_manualReviewedByAdminId_fkey"
  FOREIGN KEY ("manualReviewedByAdminId") REFERENCES "AdminAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reply"
  ADD CONSTRAINT "Reply_manualReviewedByAdminId_fkey"
  FOREIGN KEY ("manualReviewedByAdminId") REFERENCES "AdminAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ForumImageAsset"
  ADD CONSTRAINT "ForumImageAsset_manualReviewedByAdminId_fkey"
  FOREIGN KEY ("manualReviewedByAdminId") REFERENCES "AdminAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ForumVideoAsset"
  ADD CONSTRAINT "ForumVideoAsset_manualReviewedByAdminId_fkey"
  FOREIGN KEY ("manualReviewedByAdminId") REFERENCES "AdminAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
