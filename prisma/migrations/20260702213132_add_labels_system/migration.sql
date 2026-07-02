-- AlterTable
ALTER TABLE "EmailIndex" ADD COLUMN     "autoMoveBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SenderProfile" ADD COLUMN     "autoLabels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "EmailLabel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLabel_userId_idx" ON "EmailLabel"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLabel_userId_name_key" ON "EmailLabel"("userId", "name");

-- CreateIndex
CREATE INDEX "EmailIndex_accountId_labels_idx" ON "EmailIndex"("accountId", "labels");

-- AddForeignKey
ALTER TABLE "EmailLabel" ADD CONSTRAINT "EmailLabel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
