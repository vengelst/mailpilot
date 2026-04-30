-- AlterTable
ALTER TABLE "MailFolder" ADD COLUMN     "lastSeenUid" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "uidValidity" BIGINT;
