ALTER TABLE "MarketOrder"
  ADD COLUMN "meetupReminderSentAt" TIMESTAMP(3);

CREATE INDEX "MarketOrder_status_meetupTime_idx"
  ON "MarketOrder"("status", "meetupTime");

CREATE TABLE "MarketPreference" (
  "userId" INTEGER NOT NULL,
  "matchNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "meetupRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "MarketMatchNotice" (
  "id" SERIAL NOT NULL,
  "itemId" INTEGER NOT NULL,
  "wantedPostId" INTEGER NOT NULL,
  "recipientId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketMatchNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketMatchNotice_itemId_wantedPostId_recipientId_kind_key"
  ON "MarketMatchNotice"("itemId", "wantedPostId", "recipientId", "kind");
CREATE INDEX "MarketMatchNotice_recipientId_createdAt_idx"
  ON "MarketMatchNotice"("recipientId", "createdAt");
CREATE INDEX "MarketMatchNotice_wantedPostId_score_idx"
  ON "MarketMatchNotice"("wantedPostId", "score");

ALTER TABLE "MarketPreference"
  ADD CONSTRAINT "MarketPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketMatchNotice"
  ADD CONSTRAINT "MarketMatchNotice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketMatchNotice"
  ADD CONSTRAINT "MarketMatchNotice_wantedPostId_fkey" FOREIGN KEY ("wantedPostId") REFERENCES "WantedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketMatchNotice"
  ADD CONSTRAINT "MarketMatchNotice_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
