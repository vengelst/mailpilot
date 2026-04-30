CREATE TABLE "public"."SignatureSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signatureText" TEXT NOT NULL DEFAULT '',
    "includeOnNewMail" BOOLEAN NOT NULL DEFAULT true,
    "includeOnReply" BOOLEAN NOT NULL DEFAULT true,
    "includeOnForward" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignatureSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureSettings_userId_key" ON "public"."SignatureSettings"("userId");
CREATE INDEX "SignatureSettings_userId_idx" ON "public"."SignatureSettings"("userId");

ALTER TABLE "public"."SignatureSettings"
ADD CONSTRAINT "SignatureSettings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
