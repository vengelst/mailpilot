import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { saveAttachmentToCloud } from "@/server/cloud/service";
import { writeAuditLog } from "@/server/audit/auditLog";
import { prisma } from "@/server/db/prisma";
import { SupportedCloudProvider } from "@/server/cloud/types";

const schema = z.object({
  provider: z.enum(["google_drive", "onedrive", "mock"]),
  targetPath: z.string().min(1),
});

async function resolveParams(
  params: Promise<{ id: string; attachmentId: string }> | { id: string; attachmentId: string },
) {
  const resolved = await Promise.resolve(params);
  return { id: resolved.id, attachmentId: resolved.attachmentId };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> | { id: string; attachmentId: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { id, attachmentId } = await resolveParams(context.params);
  const payload = schema.safeParse(await req.json().catch(() => ({})));
  if (!payload.success) return fail("Invalid payload", 400);

  const ownedAttachment = await prisma.emailAttachment.findFirst({
    where: {
      id: attachmentId,
      emailId: id,
      email: { account: { userId: session.userId } },
    },
    include: {
      email: {
        select: { accountId: true },
      },
    },
  });
  if (!ownedAttachment) return fail("Attachment not found", 404);

  try {
    const result = await saveAttachmentToCloud({
      userId: session.userId,
      emailId: id,
      attachmentId,
      provider: payload.data.provider as SupportedCloudProvider | "mock",
      targetPath: payload.data.targetPath,
    });

    await writeAuditLog({
      userId: session.userId,
      accountId: result.email.accountId,
      emailId: id,
      action: "attachment.saved_to_cloud",
      actor: "user",
      afterJson: {
        attachmentId,
        provider: payload.data.provider,
        targetPath: result.uploadResult.path,
        cloudFileId: result.uploadResult.fileId,
      },
    });

    return ok({
      attachment: result.attachment,
      upload: result.uploadResult,
    });
  } catch (error) {
    await prisma.emailAttachment.update({
      where: { id: attachmentId },
      data: {
        saveStatus: "error",
        saveError: error instanceof Error ? error.message : "Cloud save failed",
      } as never,
    });
    await writeAuditLog({
      userId: session.userId,
      accountId: ownedAttachment.email.accountId,
      emailId: id,
      action: "attachment.save_to_cloud_failed",
      actor: "system",
      afterJson: {
        attachmentId,
        provider: payload.data.provider,
        error: error instanceof Error ? error.message : "Cloud save failed",
      },
    });

    return fail(error instanceof Error ? error.message : "Cloud save failed", 400);
  }
}
