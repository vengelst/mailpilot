-- AlterTable
ALTER TABLE "MailAccount" ADD COLUMN     "excludedFolders" TEXT[] DEFAULT ARRAY[]::TEXT[];
