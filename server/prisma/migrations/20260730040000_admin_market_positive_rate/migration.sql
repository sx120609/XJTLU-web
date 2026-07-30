ALTER TABLE "User"
ADD COLUMN "marketPositiveRate" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "marketPositiveRateReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN "marketPositiveRateUpdatedAt" TIMESTAMP(3);

ALTER TABLE "User"
ADD CONSTRAINT "User_marketPositiveRate_check"
CHECK ("marketPositiveRate" >= 0 AND "marketPositiveRate" <= 100);
