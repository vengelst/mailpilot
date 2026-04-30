import { prisma } from "@/server/db/prisma";

export async function runAttachmentJob(input: {
  userId: string;
  accountId?: string;
  emailIds: string[];
  autoSaveAttachments: boolean;
}) {
  if (!input.autoSaveAttachments || !input.emailIds.length) {
    return { queuedAttachments: 0, savedAttachments: 0 };
  }

  const attachments = await prisma.emailAttachment.findMany({
    where: {
      emailId: { in: input.emailIds },
      saveStatus: "not_saved",
      email: {
        account: {
          userId: input.userId,
          ...(input.accountId ? { id: input.accountId } : {}),
        },
      },
    },
    select: { id: true },
    take: 200,
  });

  if (!attachments.length) {
    return { queuedAttachments: 0, savedAttachments: 0 };
  }

  await prisma.emailAttachment.updateMany({
    where: { id: { in: attachments.map((item) => item.id) } },
    data: {
      saveError: "queued_for_manual_save",
    },
  });

  return { queuedAttachments: attachments.length, savedAttachments: 0 };
}
