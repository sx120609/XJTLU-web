-- 靠浦 V1 迭代三：交易积分、统一热门排序与隐私最小化产品指标。
-- 论坛 reputation 不迁移、不复用；交易积分仅由可审计业务事件产生。

ALTER TABLE "User"
  ADD COLUMN "transactionPoints" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User"
  ADD CONSTRAINT "User_transactionPoints_check" CHECK ("transactionPoints" >= 0);

ALTER TABLE "Topic"
  ADD COLUMN "hotScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hotSignals" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "hotScoreUpdatedAt" TIMESTAMP(3);

ALTER TABLE "MarketItem"
  ADD COLUMN "hotScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hotSignals" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "hotScoreUpdatedAt" TIMESTAMP(3);

ALTER TABLE "WantedPost"
  ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hotScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hotSignals" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "hotScoreUpdatedAt" TIMESTAMP(3);

CREATE TABLE "TransactionPointEntry" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "event" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransactionPointEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductActivityDaily" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "dateKey" TEXT NOT NULL,
  "surface" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'direct',
  "visitCount" INTEGER NOT NULL DEFAULT 1,
  "firstVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductActivityDaily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductActivityDaily_visitCount_check" CHECK ("visitCount" >= 1)
);

CREATE UNIQUE INDEX "TransactionPointEntry_userId_event_sourceType_sourceId_key"
  ON "TransactionPointEntry"("userId", "event", "sourceType", "sourceId");
CREATE INDEX "TransactionPointEntry_userId_createdAt_idx"
  ON "TransactionPointEntry"("userId", "createdAt");
CREATE INDEX "TransactionPointEntry_event_createdAt_idx"
  ON "TransactionPointEntry"("event", "createdAt");

CREATE UNIQUE INDEX "ProductActivityDaily_userId_dateKey_surface_source_key"
  ON "ProductActivityDaily"("userId", "dateKey", "surface", "source");
CREATE INDEX "ProductActivityDaily_dateKey_surface_idx"
  ON "ProductActivityDaily"("dateKey", "surface");
CREATE INDEX "ProductActivityDaily_userId_dateKey_idx"
  ON "ProductActivityDaily"("userId", "dateKey");
CREATE INDEX "ProductActivityDaily_surface_lastVisitedAt_idx"
  ON "ProductActivityDaily"("surface", "lastVisitedAt");

CREATE INDEX "Topic_hidden_hotScore_createdAt_idx"
  ON "Topic"("hidden", "hotScore", "createdAt");
CREATE INDEX "MarketItem_listingType_status_hotScore_createdAt_idx"
  ON "MarketItem"("listingType", "status", "hotScore", "createdAt");
CREATE INDEX "WantedPost_status_hotScore_createdAt_idx"
  ON "WantedPost"("status", "hotScore", "createdAt");

ALTER TABLE "TransactionPointEntry"
  ADD CONSTRAINT "TransactionPointEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductActivityDaily"
  ADD CONSTRAINT "ProductActivityDaily_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 历史完成的实体交易（排除学习资料的底层订单）。
INSERT INTO "TransactionPointEntry" ("userId", "delta", "event", "sourceType", "sourceId", "reason")
SELECT "buyerId", 20, 'physical_trade_buyer_completed', 'market_order', "id"::TEXT, '完成实体交易'
FROM "MarketOrder" mo
WHERE mo."status" = 'completed'
  AND mo."deliveryType" = 'physical'
  AND NOT EXISTS (SELECT 1 FROM "LearningCommerceOrder" lco WHERE lco."orderId" = mo."id")
UNION ALL
SELECT "sellerId", 20, 'physical_trade_seller_completed', 'market_order', "id"::TEXT, '完成实体交易'
FROM "MarketOrder" mo
WHERE mo."status" = 'completed'
  AND mo."deliveryType" = 'physical'
  AND NOT EXISTS (SELECT 1 FROM "LearningCommerceOrder" lco WHERE lco."orderId" = mo."id");

-- 历史完成的付费学习资料订单。
INSERT INTO "TransactionPointEntry" ("userId", "delta", "event", "sourceType", "sourceId", "reason")
SELECT mo."buyerId", 10, 'learning_trade_buyer_completed', 'learning_order', lco."id"::TEXT, '完成学习资料订单'
FROM "LearningCommerceOrder" lco
JOIN "MarketOrder" mo ON mo."id" = lco."orderId"
WHERE lco."status" = 'completed'
UNION ALL
SELECT mo."sellerId", 20, 'learning_trade_creator_completed', 'learning_order', lco."id"::TEXT, '完成学习资料交付'
FROM "LearningCommerceOrder" lco
JOIN "MarketOrder" mo ON mo."id" = lco."orderId"
WHERE lco."status" = 'completed';

-- 历史有效求购响应。
INSERT INTO "TransactionPointEntry" ("userId", "delta", "event", "sourceType", "sourceId", "reason")
SELECT wr."sellerId", 8, 'wanted_response_accepted', 'wanted_response', wr."id"::TEXT, '求购响应被采纳'
FROM "WantedResponse" wr
WHERE EXISTS (
  SELECT 1
  FROM "MarketOrder" mo
  WHERE mo."wantedResponseId" = wr."id"
);

-- 历史实体交易评价。
INSERT INTO "TransactionPointEntry" ("userId", "delta", "event", "sourceType", "sourceId", "reason")
SELECT mr."authorId", 2, 'physical_review_authored', 'market_review', mr."id"::TEXT, '发布成交评价'
FROM "MarketReview" mr
JOIN "MarketOrder" mo ON mo."id" = mr."orderId"
WHERE mo."deliveryType" = 'physical'
  AND NOT EXISTS (
  SELECT 1
  FROM "LearningCommerceOrder" lco
  WHERE lco."orderId" = mr."orderId"
)
UNION ALL
SELECT mr."targetUserId", 5, 'physical_positive_review_received', 'market_review', mr."id"::TEXT, '收到四星及以上评价'
FROM "MarketReview" mr
JOIN "MarketOrder" mo ON mo."id" = mr."orderId"
WHERE mr."rating" >= 4
  AND mo."deliveryType" = 'physical'
  AND NOT EXISTS (
    SELECT 1
    FROM "LearningCommerceOrder" lco
    WHERE lco."orderId" = mr."orderId"
  );

-- 历史学习资料评价。
INSERT INTO "TransactionPointEntry" ("userId", "delta", "event", "sourceType", "sourceId", "reason")
SELECT "buyerId", 2, 'learning_rating_authored', 'learning_rating', "id"::TEXT, '发布资料评价'
FROM "LearningMaterialRating"
WHERE "status" = 'published'
UNION ALL
SELECT "creatorId", 5, 'learning_positive_rating_received', 'learning_rating', "id"::TEXT, '资料收到四星及以上评价'
FROM "LearningMaterialRating"
WHERE "status" = 'published' AND "overall" >= 4;

-- 每个曾经审核发布的资料版本仅奖励一次；已被新版本替代的 retired 版本仍保留历史贡献。
INSERT INTO "TransactionPointEntry" ("userId", "delta", "event", "sourceType", "sourceId", "reason")
SELECT "createdById", 15, 'learning_material_approved', 'learning_version', "id"::TEXT, '学习资料审核通过'
FROM "LearningMaterialVersion"
WHERE "publishedAt" IS NOT NULL;

-- 已被运营判定有效的举报。
INSERT INTO "TransactionPointEntry" ("userId", "delta", "event", "sourceType", "sourceId", "reason")
SELECT "reporterId", 5, 'valid_report', 'market_report', "id"::TEXT, '有效举报'
FROM "MarketReport"
WHERE "status" = 'resolved';

-- 先缓存全部正向历史贡献。负向事件按迁移时余额逐条封底，
-- 这样日后撤销处理时只会返还当时实际扣除的积分。
UPDATE "User" u
SET "transactionPoints" = totals.points
FROM (
  SELECT "userId", GREATEST(0, SUM("delta"))::INTEGER AS points
  FROM "TransactionPointEntry"
  GROUP BY "userId"
) totals
WHERE u."id" = totals."userId";

DO $$
DECLARE
  event_row RECORD;
  current_points INTEGER;
  applied_delta INTEGER;
BEGIN
  FOR event_row IN
    SELECT *
    FROM (
      SELECT
        mo."cancelledById" AS "userId",
        -5 AS "requestedDelta",
        'accepted_order_cancelled'::TEXT AS "eventName",
        'market_order'::TEXT AS "sourceType",
        mo."id"::TEXT AS "sourceId",
        '接受交易后主动取消'::TEXT AS "reason",
        COALESCE(mo."closedAt", mo."updatedAt", mo."createdAt") AS "occurredAt"
      FROM "MarketOrder" mo
      WHERE mo."status" = 'cancelled'
        AND mo."cancelledById" IS NOT NULL
        AND mo."deliveryType" = 'physical'
        AND NOT EXISTS (
          SELECT 1
          FROM "LearningCommerceOrder" lco
          WHERE lco."orderId" = mo."id"
        )

      UNION ALL

      SELECT
        mv."userId",
        CASE
          WHEN mv."level" IN ('serious', 'critical', 'high') THEN -50
          WHEN mv."level" IN ('moderate', 'medium') THEN -25
          ELSE -10
        END,
        'market_violation'::TEXT,
        'market_violation'::TEXT,
        mv."id"::TEXT,
        ('市集违规：' || mv."reason")::TEXT,
        mv."createdAt"
      FROM "MarketViolation" mv
      WHERE mv."status" <> 'revoked'

      UNION ALL

      SELECT
        lcv."creatorId",
        CASE
          WHEN lcv."severity" IN ('critical', 'high') THEN -50
          WHEN lcv."severity" = 'medium' THEN -25
          ELSE -10
        END,
        'learning_violation'::TEXT,
        'learning_violation'::TEXT,
        lcv."id"::TEXT,
        ('学习资料违规：' || lcv."reason")::TEXT,
        lcv."createdAt"
      FROM "LearningCreatorViolation" lcv
      WHERE lcv."status" <> 'revoked'
    ) historical_penalties
    ORDER BY "occurredAt", "sourceType", "sourceId"
  LOOP
    SELECT "transactionPoints"
    INTO current_points
    FROM "User"
    WHERE "id" = event_row."userId"
    FOR UPDATE;

    IF FOUND THEN
      applied_delta := -LEAST(current_points, ABS(event_row."requestedDelta"));
      INSERT INTO "TransactionPointEntry" (
        "userId",
        "delta",
        "event",
        "sourceType",
        "sourceId",
        "reason"
      )
      VALUES (
        event_row."userId",
        applied_delta,
        event_row."eventName",
        event_row."sourceType",
        event_row."sourceId",
        event_row."reason"
      );

      IF applied_delta <> 0 THEN
        UPDATE "User"
        SET "transactionPoints" = "transactionPoints" + applied_delta
        WHERE "id" = event_row."userId";
      END IF;
    END IF;
  END LOOP;
END $$;
