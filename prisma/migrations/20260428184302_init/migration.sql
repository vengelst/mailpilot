-- CreateEnum
CREATE TYPE "BlockedSenderAction" AS ENUM ('move_trash', 'move_spam', 'mark_newsletter', 'ignore');

-- CreateEnum
CREATE TYPE "ContactCandidateStatus" AS ENUM ('pending', 'exported', 'ignored', 'duplicate');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('user', 'system', 'ai', 'rule');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUsername" TEXT NOT NULL,
    "encryptedImapPassword" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailFolder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "delimiter" TEXT,
    "flags" JSONB,
    "existsCount" INTEGER NOT NULL DEFAULT 0,
    "unseenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailIndex" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL,
    "imapUid" INTEGER NOT NULL,
    "messageId" TEXT,
    "subject" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "toEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "date" TIMESTAMP(3),
    "snippet" TEXT,
    "textPreview" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "size" INTEGER,
    "aiAnalyzed" BOOLEAN NOT NULL DEFAULT false,
    "aiCategory" TEXT,
    "aiPriority" TEXT,
    "aiSummaryShort" TEXT,
    "aiSummaryLong" TEXT,
    "aiKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiRecommendedFolder" TEXT,
    "aiRecommendedAction" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAttachment" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "imapPartId" TEXT,
    "cloudProvider" TEXT,
    "cloudPath" TEXT,
    "cloudFileId" TEXT,
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditionJson" JSONB NOT NULL,
    "actionJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedSender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "domain" TEXT,
    "action" "BlockedSenderAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactCandidate" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "companyName" TEXT,
    "personName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" "ContactCandidateStatus" NOT NULL DEFAULT 'pending',
    "googleContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "error" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "accountId" TEXT,
    "emailId" TEXT,
    "action" TEXT NOT NULL,
    "actor" "AuditActor" NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MailFolder_accountId_path_key" ON "MailFolder"("accountId", "path");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_folderPath_idx" ON "EmailIndex"("accountId", "folderPath");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_subject_idx" ON "EmailIndex"("accountId", "subject");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_fromEmail_idx" ON "EmailIndex"("accountId", "fromEmail");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIndex_accountId_folderPath_imapUid_key" ON "EmailIndex"("accountId", "folderPath", "imapUid");

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailFolder" ADD CONSTRAINT "MailFolder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailIndex" ADD CONSTRAINT "EmailIndex_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailRule" ADD CONSTRAINT "MailRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedSender" ADD CONSTRAINT "BlockedSender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCandidate" ADD CONSTRAINT "ContactCandidate_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailIndex"("id") ON DELETE SET NULL ON UPDATE CASCADE;
