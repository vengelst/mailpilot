import { prisma } from "@/server/db/prisma";
import { createCloudProvider } from "@/server/cloud/providers";
import { renderTargetPath } from "@/server/cloud/pathTemplates";
import { loadAttachmentContent } from "@/server/imap/imapService";
import { SupportedCloudProvider } from "@/server/cloud/types";

export async function saveAttachmentToCloud(input: {
  userId: string;
  emailId: string;
  attachmentId: string;
  provider: SupportedCloudProvider | "mock";
  targetPath: string;
}) {
  const { email, attachment, content } = await loadAttachmentContent(
    input.userId,
    input.emailId,
    input.attachmentId,
  );

  const prismaAny = prisma as unknown as {
    cloudAccount: {
      findFirst: (args: unknown) => Promise<
        | { encryptedAccessToken: string; encryptedRefreshToken: string | null }
        | null
      >;
    };
    emailAttachment: {
      update: (args: unknown) => Promise<unknown>;
    };
  };

  const cloudAccount =
    input.provider === "mock"
      ? null
      : await prismaAny.cloudAccount.findFirst({
          where: {
            userId: input.userId,
            provider: input.provider,
          },
        });

  const provider = createCloudProvider({
    provider: input.provider,
    encryptedAccessToken: cloudAccount?.encryptedAccessToken ?? null,
    encryptedRefreshToken: cloudAccount?.encryptedRefreshToken ?? null,
  });

  const resolvedTargetPath = renderTargetPath(input.targetPath, {
    year: String((email.date ?? new Date()).getFullYear()),
    month: String((email.date ?? new Date()).getMonth() + 1).padStart(2, "0"),
    senderDomain: (email.fromEmail?.split("@")[1] ?? "unknown-domain").toLowerCase(),
    detectedCompany: "unknown-company",
    keyword: email.aiKeywords?.[0] ?? "allgemein",
  });

  const filename = attachment.filename || `attachment-${attachment.id}`;
  const uploadResult = await provider.uploadFile({
    filename,
    mimeType: attachment.mimeType,
    content,
    targetPath: resolvedTargetPath.endsWith("/") ? resolvedTargetPath : `${resolvedTargetPath}/`,
  });

  const updatedAttachment = await prismaAny.emailAttachment.update({
    where: { id: attachment.id },
    data: {
      cloudProvider: input.provider === "mock" ? null : input.provider,
      cloudPath: uploadResult.path,
      cloudFileId: uploadResult.fileId,
      savedAt: new Date(),
      saveStatus: "saved",
      saveError: null,
    },
  });

  return { email, attachment: updatedAttachment, uploadResult };
}
