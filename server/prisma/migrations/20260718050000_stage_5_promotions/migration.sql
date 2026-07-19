-- Stage 5: manually confirmed promotion services and approved merchant pages.
-- Student merchandise payments remain outside the platform; these records only
-- describe clearly labelled promotional services sold by the platform.

ALTER TABLE "MarketItem"
  ADD COLUMN "pinnedUntil" TIMESTAMP(3),
  ADD COLUMN "pinnedPromotionOrderId" INTEGER,
  ADD COLUMN "homeFeaturedUntil" TIMESTAMP(3),
  ADD COLUMN "homePromotionOrderId" INTEGER;

ALTER TABLE "WantedPost"
  ADD COLUMN "urgentUntil" TIMESTAMP(3),
  ADD COLUMN "urgentPromotionOrderId" INTEGER;

CREATE TABLE "MerchantProfile" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "priceRange" TEXT NOT NULL,
  "serviceArea" TEXT NOT NULL,
  "studentDiscount" TEXT NOT NULL DEFAULT '',
  "contactMethod" TEXT NOT NULL,
  "contactValueEncrypted" TEXT NOT NULL,
  "contactValueMasked" TEXT NOT NULL,
  "images" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'reviewing',
  "reviewNote" TEXT NOT NULL DEFAULT '',
  "reviewedById" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "activeUntil" TIMESTAMP(3),
  "activePromotionOrderId" INTEGER,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "favoriteCount" INTEGER NOT NULL DEFAULT 0,
  "inquiryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MerchantFavorite" (
  "id" SERIAL NOT NULL,
  "merchantProfileId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantFavorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MerchantInquiry" (
  "id" SERIAL NOT NULL,
  "merchantProfileId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "dayKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantInquiry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionPlan" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "placement" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "priceCents" INTEGER NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionOrder" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "planId" INTEGER NOT NULL,
  "marketItemId" INTEGER,
  "wantedPostId" INTEGER,
  "merchantProfileId" INTEGER,
  "outTradeNo" TEXT NOT NULL,
  "planCode" TEXT NOT NULL,
  "planName" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "placement" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "paymentMode" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "applicantNote" TEXT NOT NULL DEFAULT '',
  "adminNote" TEXT NOT NULL DEFAULT '',
  "reviewedById" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "startsAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "impressionCount" INTEGER NOT NULL DEFAULT 0,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionEvent" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantProfile_userId_key" ON "MerchantProfile"("userId");
CREATE UNIQUE INDEX "MerchantProfile_slug_key" ON "MerchantProfile"("slug");
CREATE UNIQUE INDEX "MerchantProfile_activePromotionOrderId_key" ON "MerchantProfile"("activePromotionOrderId");
CREATE INDEX "MerchantProfile_status_activeUntil_idx" ON "MerchantProfile"("status", "activeUntil");
CREATE INDEX "MerchantProfile_category_status_idx" ON "MerchantProfile"("category", "status");

CREATE UNIQUE INDEX "MerchantFavorite_merchantProfileId_userId_key" ON "MerchantFavorite"("merchantProfileId", "userId");
CREATE INDEX "MerchantFavorite_userId_createdAt_idx" ON "MerchantFavorite"("userId", "createdAt");
CREATE UNIQUE INDEX "MerchantInquiry_merchantProfileId_userId_dayKey_key" ON "MerchantInquiry"("merchantProfileId", "userId", "dayKey");
CREATE INDEX "MerchantInquiry_merchantProfileId_createdAt_idx" ON "MerchantInquiry"("merchantProfileId", "createdAt");

CREATE UNIQUE INDEX "PromotionPlan_code_key" ON "PromotionPlan"("code");
CREATE INDEX "PromotionPlan_enabled_sort_idx" ON "PromotionPlan"("enabled", "sort");
CREATE INDEX "PromotionPlan_type_enabled_idx" ON "PromotionPlan"("type", "enabled");

CREATE UNIQUE INDEX "PromotionOrder_outTradeNo_key" ON "PromotionOrder"("outTradeNo");
CREATE INDEX "PromotionOrder_userId_status_createdAt_idx" ON "PromotionOrder"("userId", "status", "createdAt");
CREATE INDEX "PromotionOrder_status_expiresAt_idx" ON "PromotionOrder"("status", "expiresAt");
CREATE INDEX "PromotionOrder_type_status_startsAt_expiresAt_idx" ON "PromotionOrder"("type", "status", "startsAt", "expiresAt");
CREATE INDEX "PromotionOrder_marketItemId_status_idx" ON "PromotionOrder"("marketItemId", "status");
CREATE INDEX "PromotionOrder_wantedPostId_status_idx" ON "PromotionOrder"("wantedPostId", "status");
CREATE INDEX "PromotionOrder_merchantProfileId_status_idx" ON "PromotionOrder"("merchantProfileId", "status");

CREATE UNIQUE INDEX "PromotionEvent_orderId_type_dedupeKey_key" ON "PromotionEvent"("orderId", "type", "dedupeKey");
CREATE INDEX "PromotionEvent_type_createdAt_idx" ON "PromotionEvent"("type", "createdAt");

CREATE UNIQUE INDEX "MarketItem_pinnedPromotionOrderId_key" ON "MarketItem"("pinnedPromotionOrderId");
CREATE UNIQUE INDEX "MarketItem_homePromotionOrderId_key" ON "MarketItem"("homePromotionOrderId");
CREATE UNIQUE INDEX "WantedPost_urgentPromotionOrderId_key" ON "WantedPost"("urgentPromotionOrderId");

ALTER TABLE "MerchantProfile" ADD CONSTRAINT "MerchantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantProfile" ADD CONSTRAINT "MerchantProfile_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantFavorite" ADD CONSTRAINT "MerchantFavorite_merchantProfileId_fkey" FOREIGN KEY ("merchantProfileId") REFERENCES "MerchantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantFavorite" ADD CONSTRAINT "MerchantFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantInquiry" ADD CONSTRAINT "MerchantInquiry_merchantProfileId_fkey" FOREIGN KEY ("merchantProfileId") REFERENCES "MerchantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantInquiry" ADD CONSTRAINT "MerchantInquiry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PromotionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_marketItemId_fkey" FOREIGN KEY ("marketItemId") REFERENCES "MarketItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_wantedPostId_fkey" FOREIGN KEY ("wantedPostId") REFERENCES "WantedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_merchantProfileId_fkey" FOREIGN KEY ("merchantProfileId") REFERENCES "MerchantProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromotionEvent" ADD CONSTRAINT "PromotionEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PromotionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_pinnedPromotionOrderId_fkey" FOREIGN KEY ("pinnedPromotionOrderId") REFERENCES "PromotionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_homePromotionOrderId_fkey" FOREIGN KEY ("homePromotionOrderId") REFERENCES "PromotionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WantedPost" ADD CONSTRAINT "WantedPost_urgentPromotionOrderId_fkey" FOREIGN KEY ("urgentPromotionOrderId") REFERENCES "PromotionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MerchantProfile" ADD CONSTRAINT "MerchantProfile_activePromotionOrderId_fkey" FOREIGN KEY ("activePromotionOrderId") REFERENCES "PromotionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PromotionPlan" ("code", "name", "type", "targetType", "placement", "description", "priceCents", "durationDays", "enabled", "sort", "createdAt", "updatedAt") VALUES
  ('listing_pin_7d', '商品置顶 7 天', 'listing_pin', 'market_item', 'market', '在市集列表优先展示，并明确标注“置顶”。', 590, 7, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wanted_urgent_7d', '求购加急 7 天', 'wanted_urgent', 'wanted_post', 'wanted', '在求购列表优先展示，并明确标注“加急”。', 590, 7, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('home_featured_7d', '首页推广 7 天', 'home_featured', 'market_item', 'home', '进入首页独立推广区域，并明确标注“推广”。', 1290, 7, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('merchant_homepage_30d', '合作商户主页 30 天', 'merchant_homepage', 'merchant_profile', 'merchant', '启用审核通过的合作商户主页，并明确标注“合作商户”。', 2990, 30, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
