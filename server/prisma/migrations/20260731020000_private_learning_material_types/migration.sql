DROP INDEX IF EXISTS "LearningMaterialType_normalizedName_key";

-- Existing seller-created types were introduced as review-gated records.
-- V1 now lets every verified user create and use their own type immediately.
UPDATE "LearningMaterialType"
SET "status" = 'approved'
WHERE "source" = 'seller'
  AND "status" = 'pending';

CREATE UNIQUE INDEX "LearningMaterialType_createdById_normalizedName_key"
ON "LearningMaterialType" ("createdById", "normalizedName")
WHERE "createdById" IS NOT NULL;

CREATE UNIQUE INDEX "LearningMaterialType_builtin_normalizedName_key"
ON "LearningMaterialType" ("normalizedName")
WHERE "createdById" IS NULL;
