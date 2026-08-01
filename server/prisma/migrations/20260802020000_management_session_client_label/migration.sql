-- Management sessions keep a bounded client label for session diagnostics.
-- It is intentionally not named as a visitor-tracking field.
ALTER TABLE "AdminSession"
  RENAME COLUMN "userAgent" TO "clientLabel";
