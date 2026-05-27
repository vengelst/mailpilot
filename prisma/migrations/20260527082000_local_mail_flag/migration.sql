-- CreateEnum
CREATE TYPE "LocalMailFlag" AS ENUM ('red', 'yellow', 'green');

-- AlterTable
ALTER TABLE "EmailIndex" ADD COLUMN "localFlag" "LocalMailFlag";

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_localFlag_idx" ON "EmailIndex"("accountId", "localFlag");
