ALTER TABLE "MarketReport"
  ALTER COLUMN "itemId" DROP NOT NULL,
  ADD COLUMN "wantedPostId" INTEGER,
  ADD COLUMN "orderId" INTEGER,
  ADD COLUMN "reportedUserId" INTEGER,
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'listing';

CREATE INDEX "MarketReport_wantedPostId_reporterId_idx" ON "MarketReport"("wantedPostId", "reporterId");
CREATE INDEX "MarketReport_orderId_reporterId_idx" ON "MarketReport"("orderId", "reporterId");
CREATE INDEX "MarketReport_reportedUserId_reporterId_idx" ON "MarketReport"("reportedUserId", "reporterId");

ALTER TABLE "MarketReport"
  ADD CONSTRAINT "MarketReport_wantedPostId_fkey" FOREIGN KEY ("wantedPostId") REFERENCES "WantedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MarketContactCard" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "valueEncrypted" TEXT NOT NULL,
  "valueMasked" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketContactCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketContactCard_userId_key" ON "MarketContactCard"("userId");
ALTER TABLE "MarketContactCard"
  ADD CONSTRAINT "MarketContactCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MarketSafetyRule" (
  "id" SERIAL NOT NULL,
  "keyword" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'prohibited',
  "action" TEXT NOT NULL DEFAULT 'block',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT NOT NULL DEFAULT '',
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketSafetyRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketSafetyRule_keyword_key" ON "MarketSafetyRule"("keyword");
CREATE INDEX "MarketSafetyRule_enabled_action_category_idx" ON "MarketSafetyRule"("enabled", "action", "category");
ALTER TABLE "MarketSafetyRule"
  ADD CONSTRAINT "MarketSafetyRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MarketViolation" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "itemId" INTEGER,
  "wantedPostId" INTEGER,
  "orderId" INTEGER,
  "type" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'warning',
  "action" TEXT NOT NULL DEFAULT 'warning',
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3),
  "createdById" INTEGER,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketViolation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketViolation_userId_status_createdAt_idx" ON "MarketViolation"("userId", "status", "createdAt");
CREATE INDEX "MarketViolation_status_expiresAt_idx" ON "MarketViolation"("status", "expiresAt");
CREATE INDEX "MarketViolation_createdById_createdAt_idx" ON "MarketViolation"("createdById", "createdAt");
ALTER TABLE "MarketViolation"
  ADD CONSTRAINT "MarketViolation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketViolation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketViolation_wantedPostId_fkey" FOREIGN KEY ("wantedPostId") REFERENCES "WantedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketViolation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketViolation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MarketAppeal" (
  "id" SERIAL NOT NULL,
  "violationId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "handledById" INTEGER,
  "handledNote" TEXT NOT NULL DEFAULT '',
  "handledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketAppeal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketAppeal_violationId_userId_key" ON "MarketAppeal"("violationId", "userId");
CREATE INDEX "MarketAppeal_status_createdAt_idx" ON "MarketAppeal"("status", "createdAt");
CREATE INDEX "MarketAppeal_handledById_handledAt_idx" ON "MarketAppeal"("handledById", "handledAt");
ALTER TABLE "MarketAppeal"
  ADD CONSTRAINT "MarketAppeal_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "MarketViolation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketAppeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketAppeal_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AdminActionLog" (
  "id" SERIAL NOT NULL,
  "actorId" INTEGER,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '{}',
  "ip" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminActionLog_actorId_createdAt_idx" ON "AdminActionLog"("actorId", "createdAt");
CREATE INDEX "AdminActionLog_targetType_targetId_createdAt_idx" ON "AdminActionLog"("targetType", "targetId", "createdAt");
CREATE INDEX "AdminActionLog_action_createdAt_idx" ON "AdminActionLog"("action", "createdAt");
ALTER TABLE "AdminActionLog"
  ADD CONSTRAINT "AdminActionLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "MarketSafetyRule" ("keyword", "category", "action", "note", "updatedAt") VALUES
  ('代考', 'academic_integrity', 'block', '禁止代考或替考服务', CURRENT_TIMESTAMP),
  ('替考', 'academic_integrity', 'block', '禁止代考或替考服务', CURRENT_TIMESTAMP),
  ('处方药', 'controlled_goods', 'block', '禁止交易处方药', CURRENT_TIMESTAMP),
  ('电子烟', 'controlled_goods', 'block', '禁止交易烟草及电子烟', CURRENT_TIMESTAMP),
  ('烟草', 'controlled_goods', 'block', '禁止交易烟草及电子烟', CURRENT_TIMESTAMP),
  ('管制刀具', 'controlled_goods', 'block', '禁止交易管制物品', CURRENT_TIMESTAMP),
  ('博彩', 'financial_risk', 'block', '禁止博彩相关服务', CURRENT_TIMESTAMP),
  ('贷款', 'financial_risk', 'block', '禁止贷款或套现服务', CURRENT_TIMESTAMP),
  ('套现', 'financial_risk', 'block', '禁止贷款或套现服务', CURRENT_TIMESTAMP),
  ('出售账号', 'account_trade', 'block', '禁止账号及身份信息交易', CURRENT_TIMESTAMP),
  ('身份证', 'personal_data', 'block', '禁止身份信息交易', CURRENT_TIMESTAMP),
  ('银行卡', 'personal_data', 'block', '禁止金融账户交易', CURRENT_TIMESTAMP),
  ('微信', 'contact_diversion', 'review', '公开内容中出现站外联系方式需复核', CURRENT_TIMESTAMP),
  ('加我微信', 'contact_diversion', 'review', '公开内容中出现站外联系方式需复核', CURRENT_TIMESTAMP),
  ('手机号', 'contact_diversion', 'review', '公开内容中出现站外联系方式需复核', CURRENT_TIMESTAMP),
  ('QQ号', 'contact_diversion', 'review', '公开内容中出现站外联系方式需复核', CURRENT_TIMESTAMP);
