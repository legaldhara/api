-- AlterTable
ALTER TABLE "ApplicationUpdate" ADD COLUMN     "pendingDocs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingPayment" BOOLEAN NOT NULL DEFAULT false;
