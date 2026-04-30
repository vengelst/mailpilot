-- CreateTable
CREATE TABLE "AutomationSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runOnAppStart" BOOLEAN NOT NULL DEFAULT false,
    "runIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "autoAnalyzeNewEmails" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyUserRules" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyAiSuggestions" BOOLEAN NOT NULL DEFAULT false,
    "aiMinConfidenceForMove" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "aiMinConfidenceForTrash" DOUBLE PRECISION NOT NULL DEFAULT 0.98,
    "aiMinConfidenceForSpam" DOUBLE PRECISION NOT NULL DEFAULT 0.98,
    "autoSaveAttachments" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationSettings_userId_key" ON "AutomationSettings"("userId");

-- AddForeignKey
ALTER TABLE "AutomationSettings" ADD CONSTRAINT "AutomationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
