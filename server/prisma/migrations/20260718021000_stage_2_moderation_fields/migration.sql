ALTER TABLE "MarketItem"
  ADD COLUMN "moderationNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "moderatedAt" TIMESTAMP(3);

ALTER TABLE "WantedPost"
  ADD COLUMN "moderationNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "moderatedAt" TIMESTAMP(3);
