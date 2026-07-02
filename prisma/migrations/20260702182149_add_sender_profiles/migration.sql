-- AlterTable
ALTER TABLE "EmailIndex" ADD COLUMN     "autoClassified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suggestedFolder" TEXT;

-- CreateTable
CREATE TABLE "SenderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileName" TEXT NOT NULL,
    "patterns" TEXT[],
    "category" TEXT NOT NULL,
    "targetFolder" TEXT NOT NULL,
    "accountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SenderProfile_userId_idx" ON "SenderProfile"("userId");

-- CreateIndex
CREATE INDEX "SenderProfile_userId_isActive_idx" ON "SenderProfile"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "SenderProfile" ADD CONSTRAINT "SenderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderProfile" ADD CONSTRAINT "SenderProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
