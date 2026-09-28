-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';

-- AlterEnum
ALTER TYPE "UpdateType" ADD VALUE 'SYSTEM_GENERATED';

-- AlterTable
ALTER TABLE "CertificateUpdate" ADD COLUMN     "chargesRequired" DECIMAL(65,30);
