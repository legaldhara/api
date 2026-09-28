/*
  Warnings:

  - Made the column `governmentCharges` on table `Service` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "premiumPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
ALTER COLUMN "governmentCharges" SET NOT NULL;
