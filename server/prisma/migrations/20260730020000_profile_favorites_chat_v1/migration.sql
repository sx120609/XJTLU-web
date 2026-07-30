-- 将身份信用与收藏提升为全站能力，并补齐交易私聊的分页、未读、幂等与治理基础。

CREATE TABLE "TopicFavorite" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "topicId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TopicFavorite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TopicFavorite"
  ADD CONSTRAINT "TopicFavorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopicFavorite"
  ADD CONSTRAINT "TopicFavorite_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TopicFavorite_userId_topicId_key" ON "TopicFavorite"("userId", "topicId");
CREATE INDEX "TopicFavorite_userId_createdAt_idx" ON "TopicFavorite"("userId", "createdAt");
CREATE INDEX "TopicFavorite_topicId_createdAt_idx" ON "TopicFavorite"("topicId", "createdAt");

ALTER TABLE "MarketConversation"
  ADD COLUMN "buyerLastReadAt" TIMESTAMP(3),
  ADD COLUMN "sellerLastReadAt" TIMESTAMP(3);

ALTER TABLE "MarketMessage"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN "clientMessageId" TEXT;

CREATE UNIQUE INDEX "MarketMessage_conversationId_senderId_clientMessageId_key"
  ON "MarketMessage"("conversationId", "senderId", "clientMessageId");

CREATE TABLE "MarketMessageAttachment" (
  "id" SERIAL NOT NULL,
  "messageId" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketMessageAttachment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MarketMessageAttachment"
  ADD CONSTRAINT "MarketMessageAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "MarketMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "MarketMessageAttachment_messageId_sort_idx"
  ON "MarketMessageAttachment"("messageId", "sort");

CREATE TABLE "MarketConversationBlock" (
  "id" SERIAL NOT NULL,
  "conversationId" INTEGER NOT NULL,
  "blockerId" INTEGER NOT NULL,
  "blockedUserId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketConversationBlock_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MarketConversationBlock"
  ADD CONSTRAINT "MarketConversationBlock_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "MarketConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketConversationBlock"
  ADD CONSTRAINT "MarketConversationBlock_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketConversationBlock"
  ADD CONSTRAINT "MarketConversationBlock_blockedUserId_fkey"
  FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "MarketConversationBlock_conversationId_blockerId_key"
  ON "MarketConversationBlock"("conversationId", "blockerId");
CREATE INDEX "MarketConversationBlock_blockedUserId_createdAt_idx"
  ON "MarketConversationBlock"("blockedUserId", "createdAt");

ALTER TABLE "MarketReport"
  ADD COLUMN "conversationId" INTEGER,
  ADD COLUMN "messageId" INTEGER;
ALTER TABLE "MarketReport"
  ADD CONSTRAINT "MarketReport_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "MarketConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketReport"
  ADD CONSTRAINT "MarketReport_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "MarketMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "MarketReport_conversationId_reporterId_idx"
  ON "MarketReport"("conversationId", "reporterId");
CREATE UNIQUE INDEX "MarketReport_messageId_reporterId_key"
  ON "MarketReport"("messageId", "reporterId");

-- 交易沟通统一使用站内私聊；历史加密联系卡不再保留。
DROP TABLE IF EXISTS "MarketContactCard";
