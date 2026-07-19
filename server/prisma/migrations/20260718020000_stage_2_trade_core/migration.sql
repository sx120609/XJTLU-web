-- Stage 2 keeps MarketItem and MarketOrder as the compatible listing/reservation
-- records while adding structured listing fields, independent wanted posts and
-- trade intents. Historical payment columns remain untouched for read-only data.

ALTER TABLE "MarketItem"
  ADD COLUMN "brand" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "model" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "usageDuration" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "flaws" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "accessories" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "testAllowed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "availableTime" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contactVisibility" TEXT NOT NULL DEFAULT 'after_accept',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "renewedAt" TIMESTAMP(3),
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN "sourceWantedPostId" INTEGER;

UPDATE "MarketItem"
SET "expiresAt" = "createdAt" + INTERVAL '30 days'
WHERE "status" IN ('active', 'reserved') AND "deliveryType" = 'physical';

CREATE TABLE "TradeIntent" (
  "id" SERIAL NOT NULL,
  "itemId" INTEGER NOT NULL,
  "buyerId" INTEGER NOT NULL,
  "proposedPriceCents" INTEGER NOT NULL,
  "message" TEXT NOT NULL DEFAULT '',
  "availableTime" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WantedPost" (
  "id" SERIAL NOT NULL,
  "authorId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "budgetMinCents" INTEGER NOT NULL,
  "budgetMaxCents" INTEGER NOT NULL,
  "brandModel" TEXT NOT NULL DEFAULT '',
  "condition" TEXT NOT NULL DEFAULT '',
  "expectedTradeTime" TEXT NOT NULL DEFAULT '',
  "campus" TEXT NOT NULL DEFAULT '',
  "location" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL,
  "allowSellerOffers" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WantedPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WantedResponse" (
  "id" SERIAL NOT NULL,
  "wantedPostId" INTEGER NOT NULL,
  "sellerId" INTEGER NOT NULL,
  "itemId" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "availableTime" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WantedResponse_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MarketOrder"
  ALTER COLUMN "offerId" DROP NOT NULL,
  ADD COLUMN "tradeIntentId" INTEGER,
  ADD COLUMN "wantedPostId" INTEGER,
  ADD COLUMN "wantedResponseId" INTEGER,
  ADD COLUMN "cancelReason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "cancelledById" INTEGER,
  ADD COLUMN "noShowParty" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX "MarketOrder_tradeIntentId_key" ON "MarketOrder"("tradeIntentId");
CREATE UNIQUE INDEX "MarketOrder_wantedResponseId_key" ON "MarketOrder"("wantedResponseId");
CREATE INDEX "MarketItem_expiresAt_status_idx" ON "MarketItem"("expiresAt", "status");
CREATE INDEX "MarketItem_sourceWantedPostId_idx" ON "MarketItem"("sourceWantedPostId");
CREATE INDEX "TradeIntent_itemId_status_createdAt_idx" ON "TradeIntent"("itemId", "status", "createdAt");
CREATE INDEX "TradeIntent_buyerId_status_createdAt_idx" ON "TradeIntent"("buyerId", "status", "createdAt");
CREATE INDEX "TradeIntent_status_expiresAt_idx" ON "TradeIntent"("status", "expiresAt");
CREATE INDEX "WantedPost_status_createdAt_idx" ON "WantedPost"("status", "createdAt");
CREATE INDEX "WantedPost_category_status_createdAt_idx" ON "WantedPost"("category", "status", "createdAt");
CREATE INDEX "WantedPost_authorId_status_updatedAt_idx" ON "WantedPost"("authorId", "status", "updatedAt");
CREATE INDEX "WantedPost_expiresAt_status_idx" ON "WantedPost"("expiresAt", "status");
CREATE INDEX "WantedResponse_wantedPostId_status_createdAt_idx" ON "WantedResponse"("wantedPostId", "status", "createdAt");
CREATE INDEX "WantedResponse_sellerId_status_createdAt_idx" ON "WantedResponse"("sellerId", "status", "createdAt");
CREATE INDEX "MarketOrder_wantedPostId_status_createdAt_idx" ON "MarketOrder"("wantedPostId", "status", "createdAt");
CREATE INDEX "MarketOrder_cancelledById_idx" ON "MarketOrder"("cancelledById");

ALTER TABLE "TradeIntent" ADD CONSTRAINT "TradeIntent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeIntent" ADD CONSTRAINT "TradeIntent_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WantedPost" ADD CONSTRAINT "WantedPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_wantedPostId_fkey" FOREIGN KEY ("wantedPostId") REFERENCES "WantedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketItem" ADD CONSTRAINT "MarketItem_sourceWantedPostId_fkey" FOREIGN KEY ("sourceWantedPostId") REFERENCES "WantedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_tradeIntentId_fkey" FOREIGN KEY ("tradeIntentId") REFERENCES "TradeIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_wantedPostId_fkey" FOREIGN KEY ("wantedPostId") REFERENCES "WantedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_wantedResponseId_fkey" FOREIGN KEY ("wantedResponseId") REFERENCES "WantedResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketOrder" ADD CONSTRAINT "MarketOrder_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
