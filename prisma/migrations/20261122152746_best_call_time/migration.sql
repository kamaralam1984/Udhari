-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "bestCallMaxDeferHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "useBestCallTime" BOOLEAN NOT NULL DEFAULT false;
