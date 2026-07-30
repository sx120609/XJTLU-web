-- 靠浦 V1：简化实体交易、统一积分语义、信誉只由审核成立的违规扣减。

ALTER TABLE "User" ALTER COLUMN "reputation" SET DEFAULT 100;
UPDATE "User" SET "reputation" = 100;

ALTER TABLE "Topic"
  ADD COLUMN "boostedUntil" TIMESTAMP(3),
  ADD COLUMN "boostPointsSpent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MarketItem"
  ADD COLUMN "boostedUntil" TIMESTAMP(3),
  ADD COLUMN "boostPointsSpent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WantedPost"
  ADD COLUMN "boostedUntil" TIMESTAMP(3),
  ADD COLUMN "boostPointsSpent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MarketViolation"
  ADD COLUMN "reputationDelta" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LearningCreatorViolation"
  ADD COLUMN "reputationDelta" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PointBoost" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" INTEGER NOT NULL,
  "points" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PointBoost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentViewDaily" (
  "id" SERIAL NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" INTEGER NOT NULL,
  "viewerKey" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentViewDaily_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PointBoost"
  ADD CONSTRAINT "PointBoost_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Topic_hidden_boostedUntil_createdAt_idx"
  ON "Topic"("hidden", "boostedUntil", "createdAt");
CREATE INDEX "MarketItem_listingType_status_boostedUntil_createdAt_idx"
  ON "MarketItem"("listingType", "status", "boostedUntil", "createdAt");
CREATE INDEX "WantedPost_status_boostedUntil_createdAt_idx"
  ON "WantedPost"("status", "boostedUntil", "createdAt");
CREATE INDEX "PointBoost_userId_createdAt_idx"
  ON "PointBoost"("userId", "createdAt");
CREATE INDEX "PointBoost_targetType_targetId_expiresAt_idx"
  ON "PointBoost"("targetType", "targetId", "expiresAt");
CREATE UNIQUE INDEX "ContentViewDaily_targetType_targetId_viewerKey_dayKey_key"
  ON "ContentViewDaily"("targetType", "targetId", "viewerKey", "dayKey");
CREATE INDEX "ContentViewDaily_dayKey_createdAt_idx"
  ON "ContentViewDaily"("dayKey", "createdAt");

-- 所有公开广场频道统一开放免费匿名发帖与回复。
UPDATE "Board"
SET "anonymousEnabled" = TRUE
WHERE "section" IS NOT NULL;

-- 保留原 slug，避免历史链接失效，只更新频道产品语义。
UPDATE "Board"
SET
  "name" = '2+2专区',
  "description" = '西浦2+2交流专区',
  "icon" = '🌍'
WHERE "slug" = 'ielts';

-- 将尚未付款的旧预约平滑迁移为洽谈记录；新流程不再创建预约。
UPDATE "MarketOrder"
SET
  "status" = 'negotiating',
  "meetupTime" = NULL,
  "meetupLocation" = '',
  "expiresAt" = NULL
WHERE
  "deliveryType" = 'physical'
  AND "paidAt" IS NULL
  AND "status" IN ('reserved', 'delivering');

UPDATE "MarketItem"
SET "status" = 'active'
WHERE "deliveryType" = 'physical' AND "status" = 'reserved';

-- 旧版热度曾将可解释分数额外乘以 100；清空后由新模型重新计算。
UPDATE "Topic" SET "hotScore" = 0, "hotScoreUpdatedAt" = NULL;
UPDATE "MarketItem" SET "hotScore" = 0, "hotScoreUpdatedAt" = NULL;
UPDATE "WantedPost" SET "hotScore" = 0, "hotScoreUpdatedAt" = NULL;
