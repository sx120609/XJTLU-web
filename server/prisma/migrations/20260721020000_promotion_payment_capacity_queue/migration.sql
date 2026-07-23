ALTER TABLE "PromotionOrder"
  ADD COLUMN "paymentCode" VARCHAR(4) NOT NULL DEFAULT '',
  ADD COLUMN "paymentSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "paymentExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reservesSlot" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waitlistedAt" TIMESTAMP(3),
  ADD COLUMN "slotNotifiedAt" TIMESTAMP(3);

CREATE INDEX "PromotionOrder_type_status_createdAt_idx"
  ON "PromotionOrder"("type", "status", "createdAt");

CREATE INDEX "PromotionOrder_status_paymentExpiresAt_idx"
  ON "PromotionOrder"("status", "paymentExpiresAt");

UPDATE "PromotionPlan"
SET "maxActive" = 8,
    "description" = CASE
      WHEN "type" = 'home_featured' THEN '进入首页商品推荐位并明确标注“推广”；首页最多同时展示 8 个推广商品。'
      WHEN "type" = 'wanted_urgent' THEN '进入首页“热议与求购”和求购列表的优先位置，并明确标注“加急”；首页最多同时展示 8 条。'
      ELSE "description"
    END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" IN ('home_featured', 'wanted_urgent');
