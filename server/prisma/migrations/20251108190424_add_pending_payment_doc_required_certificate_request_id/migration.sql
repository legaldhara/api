-- AlterTable
ALTER TABLE "CertificateRequest" ADD COLUMN     "docRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingPayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "certificateRequestId" UUID;
