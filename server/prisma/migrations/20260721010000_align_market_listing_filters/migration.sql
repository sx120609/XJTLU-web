-- 商品发布单和市集筛选使用同一套交付方式值。
-- 历史的 both 表示卖家不限制交付方式，统一迁移为 any。
UPDATE "MarketItem"
SET "tradeMode" = 'any'
WHERE "tradeMode" = 'both';

-- 公开出售商品不再由卖家设置或受自动过期时间限制。
-- 已经过期的历史商品不自动恢复，仍由卖家确认后重新上架。
UPDATE "MarketItem"
SET "expiresAt" = NULL
WHERE "listingType" = 'sell'
  AND "visibility" = 'public'
  AND "status" IN ('draft', 'reviewing', 'active', 'negotiating', 'reserved', 'withdrawn');

-- 对应市集筛选单中的售价、成色、交付方式和校区。
CREATE INDEX IF NOT EXISTS "MarketItem_status_priceCents_idx"
ON "MarketItem"("status", "priceCents");

CREATE INDEX IF NOT EXISTS "MarketItem_condition_status_createdAt_idx"
ON "MarketItem"("condition", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "MarketItem_tradeMode_status_createdAt_idx"
ON "MarketItem"("tradeMode", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "MarketItem_campus_status_createdAt_idx"
ON "MarketItem"("campus", "status", "createdAt");
