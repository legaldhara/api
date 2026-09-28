ALTER TABLE "User" DROP COLUMN "password";
CREATE TABLE "AdminSecurity" ("id" UUID NOT NULL, "userId" UUID NOT NULL, "encryptedTotpSecret" TEXT NOT NULL, "enabledAt" TIMESTAMP(3), "recoveryCodeHashes" TEXT[], "lastAcceptedTimeStep" BIGINT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AdminSecurity_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AdminSecurity_userId_key" ON "AdminSecurity"("userId");
ALTER TABLE "AdminSecurity" ADD CONSTRAINT "AdminSecurity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
