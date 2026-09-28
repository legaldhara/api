ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
CREATE TYPE "OtpPurpose" AS ENUM ('SIGNUP_PHONE', 'LOGIN_PHONE');
CREATE TABLE "OtpChallenge" (
  "id" UUID NOT NULL, "purpose" "OtpPurpose" NOT NULL, "phoneHash" TEXT NOT NULL,
  "encryptedPhone" TEXT NOT NULL, "codeDigest" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "resendAt" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5, "consumedAt" TIMESTAMP(3), "invalidatedAt" TIMESTAMP(3),
  "verifiedUid" TEXT, "verifiedAt" TIMESTAMP(3),
  "requestIpHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OtpChallenge_phoneHash_purpose_createdAt_idx" ON "OtpChallenge"("phoneHash", "purpose", "createdAt");
CREATE INDEX "OtpChallenge_requestIpHash_createdAt_idx" ON "OtpChallenge"("requestIpHash", "createdAt");
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

CREATE TABLE "RateLimitBucket" (
  "id" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RateLimitBucket_scope_keyHash_windowStart_key" ON "RateLimitBucket"("scope", "keyHash", "windowStart");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

