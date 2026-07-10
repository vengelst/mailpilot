-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "htmlContent" TEXT NOT NULL DEFAULT '',
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeOnNewMail" BOOLEAN NOT NULL DEFAULT true,
    "includeOnReply" BOOLEAN NOT NULL DEFAULT true,
    "includeOnForward" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signature_userId_idx" ON "Signature"("userId");

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing SignatureSettings data into new Signature table
INSERT INTO "Signature" ("id", "userId", "name", "htmlContent", "includeOnNewMail", "includeOnReply", "includeOnForward", "isDefault", "createdAt", "updatedAt")
SELECT
  "id",
  "userId",
  'Standard',
  CASE WHEN "signatureText" != '' THEN '<p>' || replace(replace("signatureText", '&', '&amp;'), E'\n', '</p><p>') || '</p>' ELSE '' END,
  "includeOnNewMail",
  "includeOnReply",
  "includeOnForward",
  true,
  "createdAt",
  "updatedAt"
FROM "SignatureSettings"
WHERE "signatureText" IS NOT NULL AND "signatureText" != '';

-- DropForeignKey
ALTER TABLE "SignatureSettings" DROP CONSTRAINT "SignatureSettings_userId_fkey";

-- DropTable
DROP TABLE "SignatureSettings";
