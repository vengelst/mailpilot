/*
  Warnings:

  - The `cloudProvider` column on the `EmailAttachment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "CloudProvider" AS ENUM ('google_drive', 'onedrive');

-- CreateEnum
CREATE TYPE "AttachmentSaveStatus" AS ENUM ('not_saved', 'saved', 'error');

-- AlterTable
ALTER TABLE "EmailAttachment" ADD COLUMN     "saveError" TEXT,
ADD COLUMN     "saveStatus" "AttachmentSaveStatus" NOT NULL DEFAULT 'not_saved',
DROP COLUMN "cloudProvider",
ADD COLUMN     "cloudProvider" "CloudProvider";

-- CreateTable
CREATE TABLE "CloudAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "CloudProvider" NOT NULL,
    "displayName" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloudAccount_userId_provider_idx" ON "CloudAccount"("userId", "provider");

-- AddForeignKey
ALTER TABLE "CloudAccount" ADD CONSTRAINT "CloudAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
