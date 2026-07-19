-- Stage 0.5 safety boundary: student trades never use platform payment or commission.
UPDATE "MarketConfig"
SET "commissionBps" = 0,
    "learningMaterialCommissionBps" = 0,
    "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "MarketConfig"
  ALTER COLUMN "commissionBps" SET DEFAULT 0,
  ALTER COLUMN "learningMaterialCommissionBps" SET DEFAULT 0;

-- Preserve the historic category and its records, but prevent new digital listings.
UPDATE "MarketCategory"
SET "enabled" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'digital_goods';

-- Product terminology only; the stable board slug and all relations stay unchanged.
UPDATE "Board"
SET "name" = '市集',
    "description" = 'XJTLU 校内实体闲置、求购与当面交易信息'
WHERE "slug" = 'market';
