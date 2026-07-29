ALTER TABLE "Reply"
ADD COLUMN "manualReviewedById" INTEGER,
ADD COLUMN "manualReviewedAt" TIMESTAMP(3),
ADD COLUMN "manualReviewNote" TEXT;

ALTER TABLE "Reply"
ADD CONSTRAINT "Reply_manualReviewedById_fkey"
FOREIGN KEY ("manualReviewedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Reply_manualReviewedById_idx"
ON "Reply"("manualReviewedById");
