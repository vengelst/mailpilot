-- AlterTable
ALTER TABLE "EmailIndex" ADD COLUMN     "bodyFetchedAt" TIMESTAMP(3),
ADD COLUMN     "bodyHtml" TEXT,
ADD COLUMN     "bodyPlain" TEXT,
ADD COLUMN     "bodyText" TEXT;
