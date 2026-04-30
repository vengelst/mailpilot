import { prisma } from "@/server/db/prisma";

type SignatureSettingsPatch = Partial<{
  signatureText: string;
  includeOnNewMail: boolean;
  includeOnReply: boolean;
  includeOnForward: boolean;
}>;

export type SignatureSettingsRecord = {
  id: string;
  userId: string;
  signatureText: string;
  includeOnNewMail: boolean;
  includeOnReply: boolean;
  includeOnForward: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function getOrCreateSignatureSettings(userId: string): Promise<SignatureSettingsRecord> {
  const prismaAny = prisma as unknown as {
    signatureSettings: {
      findUnique: (args: unknown) => Promise<unknown | null>;
      create: (args: unknown) => Promise<unknown>;
    };
  };

  const existing = (await prismaAny.signatureSettings.findUnique({
    where: { userId },
  })) as SignatureSettingsRecord | null;
  if (existing) return existing;
  return (await prismaAny.signatureSettings.create({
    data: { userId },
  })) as SignatureSettingsRecord;
}

export async function updateSignatureSettings(
  userId: string,
  patch: SignatureSettingsPatch,
): Promise<SignatureSettingsRecord> {
  await getOrCreateSignatureSettings(userId);
  const prismaAny = prisma as unknown as {
    signatureSettings: {
      update: (args: unknown) => Promise<unknown>;
    };
  };
  return (await prismaAny.signatureSettings.update({
    where: { userId },
    data: patch,
  })) as SignatureSettingsRecord;
}
