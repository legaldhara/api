/*
  Warnings:

  - You are about to drop the column `applicationStatus` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `docRequired` on the `CertificateRequest` table. All the data in the column will be lost.
  - You are about to drop the column `isResolved` on the `CertificateRequest` table. All the data in the column will be lost.
  - You are about to drop the column `pendingPayment` on the `CertificateRequest` table. All the data in the column will be lost.
  - You are about to drop the column `resolvedAt` on the `CertificateRequest` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `CertificateRequest` table. All the data in the column will be lost.
  - You are about to drop the `ApplicationUpdate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CertificateUpdate` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ApplicationUpdate" DROP CONSTRAINT "ApplicationUpdate_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "ApplicationUpdate" DROP CONSTRAINT "ApplicationUpdate_updaterBy_fkey";

-- DropForeignKey
ALTER TABLE "CertificateUpdate" DROP CONSTRAINT "CertificateUpdate_certificateRequestId_fkey";

-- DropForeignKey
ALTER TABLE "CertificateUpdate" DROP CONSTRAINT "CertificateUpdate_updatedBy_fkey";

-- DropForeignKey
ALTER TABLE "PaymentCharge" DROP CONSTRAINT "PaymentCharge_sourceApplicationUpdateId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentCharge" DROP CONSTRAINT "PaymentCharge_sourceCertificateUpdateId_fkey";

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "applicationStatus";

-- AlterTable
ALTER TABLE "CertificateRequest" DROP COLUMN "docRequired",
DROP COLUMN "isResolved",
DROP COLUMN "pendingPayment",
DROP COLUMN "resolvedAt",
DROP COLUMN "status";

-- DropTable
DROP TABLE "ApplicationUpdate";

-- DropTable
DROP TABLE "CertificateUpdate";

-- DropEnum
DROP TYPE "ApplicationStatus";

-- DropEnum
DROP TYPE "CertificateRequestStatus";

-- DropEnum
DROP TYPE "CertificateUpdateType";

-- DropEnum
DROP TYPE "PaymentType";

-- DropEnum
DROP TYPE "UpdateType";
