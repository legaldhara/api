-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_certificateRequestId_fkey" FOREIGN KEY ("certificateRequestId") REFERENCES "CertificateRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
