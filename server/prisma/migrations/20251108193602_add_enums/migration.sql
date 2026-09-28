/*
  Warnings:

  - A unique constraint covering the columns `[transactionId]` on the table `CertificateUpdate` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CertificateUpdateType" ADD VALUE 'SYSTEM_GENERATED';
ALTER TYPE "CertificateUpdateType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "CertificateUpdateType" ADD VALUE 'PAYMENT_SUCCESS';

-- AlterTable
ALTER TABLE "CertificateUpdate" ADD COLUMN     "transactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CertificateUpdate_transactionId_key" ON "CertificateUpdate"("transactionId");
