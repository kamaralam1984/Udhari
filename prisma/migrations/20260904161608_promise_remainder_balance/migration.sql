-- AlterTable
ALTER TABLE "PromiseToPay" ADD COLUMN     "remainingAmount" DECIMAL(12,2),
ADD COLUMN     "remainingDueDate" TIMESTAMP(3);
