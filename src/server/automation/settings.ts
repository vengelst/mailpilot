import { prisma } from "@/server/db/prisma";
import { snapMailScrollBatchSize } from "@/lib/mailScrollBatch";

type SettingsPatch = Partial<{
  runOnAppStart: boolean;
  runIntervalMinutes: number;
  autoAnalyzeNewEmails: boolean;
  autoApplyUserRules: boolean;
  autoApplyAiSuggestions: boolean;
  aiMinConfidenceForMove: number;
  aiMinConfidenceForTrash: number;
  aiMinConfidenceForSpam: number;
  autoSaveAttachments: boolean;
  mailScrollBatchSize: number;
}>;

export type AutomationSettingsRecord = {
  id: string;
  userId: string;
  runOnAppStart: boolean;
  runIntervalMinutes: number;
  autoAnalyzeNewEmails: boolean;
  autoApplyUserRules: boolean;
  autoApplyAiSuggestions: boolean;
  aiMinConfidenceForMove: number;
  aiMinConfidenceForTrash: number;
  aiMinConfidenceForSpam: number;
  autoSaveAttachments: boolean;
  mailScrollBatchSize: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function getOrCreateAutomationSettings(userId: string): Promise<AutomationSettingsRecord> {
  const prismaAny = prisma as unknown as {
    automationSettings: {
      findUnique: (args: unknown) => Promise<unknown | null>;
      create: (args: unknown) => Promise<unknown>;
      update: (args: unknown) => Promise<unknown>;
    };
  };

  const existing = (await prismaAny.automationSettings.findUnique({
    where: { userId },
  })) as AutomationSettingsRecord | null;
  if (existing) return existing;
  return (await prismaAny.automationSettings.create({
    data: { userId },
  })) as AutomationSettingsRecord;
}

export async function updateAutomationSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<AutomationSettingsRecord> {
  await getOrCreateAutomationSettings(userId);
  const data: Record<string, unknown> = { ...patch };
  if (patch.mailScrollBatchSize !== undefined) {
    data.mailScrollBatchSize = snapMailScrollBatchSize(patch.mailScrollBatchSize);
  }
  const prismaAny = prisma as unknown as {
    automationSettings: {
      update: (args: unknown) => Promise<unknown>;
    };
  };
  return (await prismaAny.automationSettings.update({
    where: { userId },
    data,
  })) as AutomationSettingsRecord;
}
