-- CreateIndex
CREATE INDEX "EmailIndex_accountId_date_idx" ON "EmailIndex"("accountId", "date");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_aiCategory_idx" ON "EmailIndex"("accountId", "aiCategory");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_aiPriority_idx" ON "EmailIndex"("accountId", "aiPriority");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_hasAttachments_idx" ON "EmailIndex"("accountId", "hasAttachments");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_actionRequired_idx" ON "EmailIndex"("accountId", "actionRequired");
