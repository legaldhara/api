-- AlterEnum
ALTER TYPE "CertificateRequestStatus" ADD VALUE 'PAYMENT_REQUIRED';

-- AlterEnum
ALTER TYPE "CertificateUpdateType" ADD VALUE 'PAYMENT_REQUESTED';

-- AlterTable
ALTER TABLE "CertificateUpdate" ADD COLUMN     "newStatus" "CertificateRequestStatus",
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "prevStatus" "CertificateRequestStatus";
