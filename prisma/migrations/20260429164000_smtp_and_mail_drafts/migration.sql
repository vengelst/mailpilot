CREATE TYPE "public"."MailDraftStatus" AS ENUM ('draft', 'scheduled', 'sent', 'cancelled');

ALTER TABLE "public"."MailAccount"
ADD COLUMN "smtpHost" TEXT,
ADD COLUMN "smtpPort" INTEGER,
ADD COLUMN "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "smtpUsername" TEXT,
ADD COLUMN "encryptedSmtpPassword" TEXT,
ADD COLUMN "smtpFromName" TEXT;

CREATE TABLE "public"."MailDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "public"."MailDraftStatus" NOT NULL DEFAULT 'draft',
    "toEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "sendAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailDraft_userId_status_idx" ON "public"."MailDraft"("userId", "status");
CREATE INDEX "MailDraft_accountId_status_idx" ON "public"."MailDraft"("accountId", "status");

ALTER TABLE "public"."MailDraft"
ADD CONSTRAINT "MailDraft_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MailDraft"
ADD CONSTRAINT "MailDraft_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "public"."MailAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
