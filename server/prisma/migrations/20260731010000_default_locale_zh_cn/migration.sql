ALTER TABLE "User"
ALTER COLUMN "preferredLocale" SET DEFAULT 'zh-CN';

-- The locale column was introduced with an English default immediately before
-- this correction. Treat those values as the former product default so existing
-- accounts also open in Chinese; users can still explicitly switch to English.
UPDATE "User"
SET "preferredLocale" = 'zh-CN'
WHERE "preferredLocale" = 'en-US';
