-- 独立管理身份基础：不修改现有 User.role，先为双轨迁移提供数据模型。
CREATE TABLE "AdminAccount" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'admin',
    "status" TEXT NOT NULL DEFAULT 'active',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretCiphertext" TEXT,
    "mfaRecoveryCodesHash" TEXT,
    "permissionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAccountPermission" (
    "id" SERIAL NOT NULL,
    "adminAccountId" INTEGER NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "grantedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAccountPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminAccountId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagementAuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminAccount_username_key" ON "AdminAccount"("username");
CREATE UNIQUE INDEX "AdminAccount_one_boss_key" ON "AdminAccount"("accountType") WHERE "accountType" = 'boss';
CREATE UNIQUE INDEX "AdminAccountPermission_adminAccountId_permissionCode_key" ON "AdminAccountPermission"("adminAccountId", "permissionCode");
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

CREATE INDEX "AdminAccount_accountType_status_idx" ON "AdminAccount"("accountType", "status");
CREATE INDEX "AdminAccount_createdById_idx" ON "AdminAccount"("createdById");
CREATE INDEX "AdminAccountPermission_permissionCode_idx" ON "AdminAccountPermission"("permissionCode");
CREATE INDEX "AdminAccountPermission_grantedById_createdAt_idx" ON "AdminAccountPermission"("grantedById", "createdAt");
CREATE INDEX "AdminSession_adminAccountId_revokedAt_expiresAt_idx" ON "AdminSession"("adminAccountId", "revokedAt", "expiresAt");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE INDEX "ManagementAuditLog_actorId_createdAt_idx" ON "ManagementAuditLog"("actorId", "createdAt");
CREATE INDEX "ManagementAuditLog_targetType_targetId_createdAt_idx" ON "ManagementAuditLog"("targetType", "targetId", "createdAt");
CREATE INDEX "ManagementAuditLog_action_createdAt_idx" ON "ManagementAuditLog"("action", "createdAt");

ALTER TABLE "AdminAccount"
  ADD CONSTRAINT "AdminAccount_accountType_check"
  CHECK ("accountType" IN ('boss', 'admin'));

ALTER TABLE "AdminAccount"
  ADD CONSTRAINT "AdminAccount_status_check"
  CHECK ("status" IN ('active', 'disabled', 'locked'));

ALTER TABLE "AdminAccount"
  ADD CONSTRAINT "AdminAccount_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAccountPermission"
  ADD CONSTRAINT "AdminAccountPermission_adminAccountId_fkey"
  FOREIGN KEY ("adminAccountId") REFERENCES "AdminAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminAccountPermission"
  ADD CONSTRAINT "AdminAccountPermission_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "AdminAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminSession"
  ADD CONSTRAINT "AdminSession_adminAccountId_fkey"
  FOREIGN KEY ("adminAccountId") REFERENCES "AdminAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManagementAuditLog"
  ADD CONSTRAINT "ManagementAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "AdminAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
