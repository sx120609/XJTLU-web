-- Keep the general second-hand marketplace free while giving the learning
-- materials catalog its own configurable commission. Existing orders already
-- contain immutable fee snapshots and therefore need no rewrite.
ALTER TABLE "MarketConfig"
  ADD COLUMN "learningMaterialCommissionBps" INTEGER NOT NULL DEFAULT 500;

UPDATE "MarketConfig" SET "commissionBps" = 0;
ALTER TABLE "MarketConfig" ALTER COLUMN "commissionBps" SET DEFAULT 0;

CREATE TABLE "LearningMaterialType" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'builtin',
  "status" TEXT NOT NULL DEFAULT 'approved',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdById" INTEGER,
  "mergedIntoId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningMaterialType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningMaterialProfile" (
  "id" SERIAL NOT NULL,
  "itemId" INTEGER NOT NULL,
  "typeId" INTEGER,
  "courseCode" TEXT,
  "college" TEXT,
  "major" TEXT,
  "applicableSemester" TEXT,
  "declaredFormats" TEXT NOT NULL DEFAULT '[]',
  "pageCount" INTEGER,
  "versionLabel" TEXT,
  "language" TEXT,
  "originalityKind" TEXT,
  "originalityStatement" TEXT,
  "rightsConfirmedAt" TIMESTAMP(3),
  "activeVersionId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningMaterialProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningMaterialVersion" (
  "id" SERIAL NOT NULL,
  "profileId" INTEGER NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "label" TEXT NOT NULL DEFAULT '',
  "releaseNotes" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdById" INTEGER NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningMaterialVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningMaterialFile" (
  "id" SERIAL NOT NULL,
  "versionId" INTEGER NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "fileSize" INTEGER NOT NULL,
  "format" TEXT NOT NULL,
  "pageCount" INTEGER,
  "sha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningMaterialFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningMaterialAccess" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "versionId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "LearningMaterialAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningMaterialSupportTicket" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "buyerId" INTEGER NOT NULL,
  "sellerId" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "responseDueAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningMaterialSupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningMaterialSupportMessage" (
  "id" SERIAL NOT NULL,
  "ticketId" INTEGER NOT NULL,
  "senderId" INTEGER,
  "kind" TEXT NOT NULL DEFAULT 'user',
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningMaterialSupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningMaterialType_normalizedName_key" ON "LearningMaterialType"("normalizedName");
CREATE INDEX "LearningMaterialType_status_enabled_sort_idx" ON "LearningMaterialType"("status", "enabled", "sort");
CREATE INDEX "LearningMaterialType_createdById_status_idx" ON "LearningMaterialType"("createdById", "status");
CREATE UNIQUE INDEX "LearningMaterialProfile_itemId_key" ON "LearningMaterialProfile"("itemId");
CREATE UNIQUE INDEX "LearningMaterialProfile_activeVersionId_key" ON "LearningMaterialProfile"("activeVersionId");
CREATE INDEX "LearningMaterialProfile_courseCode_applicableSemester_idx" ON "LearningMaterialProfile"("courseCode", "applicableSemester");
CREATE INDEX "LearningMaterialProfile_typeId_applicableSemester_idx" ON "LearningMaterialProfile"("typeId", "applicableSemester");
CREATE INDEX "LearningMaterialProfile_college_major_idx" ON "LearningMaterialProfile"("college", "major");
CREATE UNIQUE INDEX "LearningMaterialVersion_profileId_versionNumber_key" ON "LearningMaterialVersion"("profileId", "versionNumber");
CREATE INDEX "LearningMaterialVersion_profileId_status_createdAt_idx" ON "LearningMaterialVersion"("profileId", "status", "createdAt");
CREATE UNIQUE INDEX "LearningMaterialFile_relativePath_key" ON "LearningMaterialFile"("relativePath");
CREATE INDEX "LearningMaterialFile_versionId_status_idx" ON "LearningMaterialFile"("versionId", "status");
CREATE INDEX "LearningMaterialFile_sha256_idx" ON "LearningMaterialFile"("sha256");
CREATE UNIQUE INDEX "LearningMaterialAccess_orderId_key" ON "LearningMaterialAccess"("orderId");
CREATE INDEX "LearningMaterialAccess_userId_revokedAt_grantedAt_idx" ON "LearningMaterialAccess"("userId", "revokedAt", "grantedAt");
CREATE INDEX "LearningMaterialAccess_versionId_userId_idx" ON "LearningMaterialAccess"("versionId", "userId");
CREATE UNIQUE INDEX "LearningMaterialSupportTicket_orderId_key" ON "LearningMaterialSupportTicket"("orderId");
CREATE INDEX "LearningMaterialSupportTicket_buyerId_status_updatedAt_idx" ON "LearningMaterialSupportTicket"("buyerId", "status", "updatedAt");
CREATE INDEX "LearningMaterialSupportTicket_sellerId_status_updatedAt_idx" ON "LearningMaterialSupportTicket"("sellerId", "status", "updatedAt");
CREATE INDEX "LearningMaterialSupportTicket_status_responseDueAt_idx" ON "LearningMaterialSupportTicket"("status", "responseDueAt");
CREATE INDEX "LearningMaterialSupportMessage_ticketId_createdAt_idx" ON "LearningMaterialSupportMessage"("ticketId", "createdAt");
CREATE INDEX "LearningMaterialSupportMessage_senderId_createdAt_idx" ON "LearningMaterialSupportMessage"("senderId", "createdAt");

ALTER TABLE "LearningMaterialType" ADD CONSTRAINT "LearningMaterialType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialType" ADD CONSTRAINT "LearningMaterialType_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "LearningMaterialType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialProfile" ADD CONSTRAINT "LearningMaterialProfile_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialProfile" ADD CONSTRAINT "LearningMaterialProfile_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "LearningMaterialType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialVersion" ADD CONSTRAINT "LearningMaterialVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LearningMaterialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialVersion" ADD CONSTRAINT "LearningMaterialVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialProfile" ADD CONSTRAINT "LearningMaterialProfile_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialFile" ADD CONSTRAINT "LearningMaterialFile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialAccess" ADD CONSTRAINT "LearningMaterialAccess_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialAccess" ADD CONSTRAINT "LearningMaterialAccess_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LearningMaterialVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialAccess" ADD CONSTRAINT "LearningMaterialAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialSupportTicket" ADD CONSTRAINT "LearningMaterialSupportTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialSupportTicket" ADD CONSTRAINT "LearningMaterialSupportTicket_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialSupportTicket" ADD CONSTRAINT "LearningMaterialSupportTicket_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialSupportMessage" ADD CONSTRAINT "LearningMaterialSupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LearningMaterialSupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningMaterialSupportMessage" ADD CONSTRAINT "LearningMaterialSupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "LearningMaterialType" ("name", "normalizedName", "source", "status", "enabled", "sort", "updatedAt") VALUES
  ('课程笔记', '课程笔记', 'builtin', 'approved', true, 10, CURRENT_TIMESTAMP),
  ('复习提纲', '复习提纲', 'builtin', 'approved', true, 20, CURRENT_TIMESTAMP),
  ('知识点总结', '知识点总结', 'builtin', 'approved', true, 30, CURRENT_TIMESTAMP),
  ('自编习题与解析', '自编习题与解析', 'builtin', 'approved', true, 40, CURRENT_TIMESTAMP),
  ('实验指南', '实验指南', 'builtin', 'approved', true, 50, CURRENT_TIMESTAMP),
  ('项目学习指南', '项目学习指南', 'builtin', 'approved', true, 60, CURRENT_TIMESTAMP),
  ('教材补充资料', '教材补充资料', 'builtin', 'approved', true, 70, CURRENT_TIMESTAMP),
  ('思维导图与速查表', '思维导图与速查表', 'builtin', 'approved', true, 80, CURRENT_TIMESTAMP),
  ('课程资源包', '课程资源包', 'builtin', 'approved', true, 90, CURRENT_TIMESTAMP),
  ('其他', '其他', 'builtin', 'approved', true, 100, CURRENT_TIMESTAMP)
ON CONFLICT ("normalizedName") DO NOTHING;
