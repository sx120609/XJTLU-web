ALTER TABLE "User"
ADD COLUMN "preferredLocale" TEXT NOT NULL DEFAULT 'en-US';

ALTER TABLE "User"
ADD CONSTRAINT "User_preferredLocale_check"
CHECK ("preferredLocale" IN ('en-US', 'zh-CN'));
