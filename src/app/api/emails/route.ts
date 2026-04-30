import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

export async function GET(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? undefined;
  const folderPath = searchParams.get("folderPath") ?? undefined;
  const q = searchParams.get("q") ?? undefined;

  const emails = await prisma.emailIndex.findMany({
    where: {
      account: { userId: session.userId },
      ...(accountId ? { accountId } : {}),
      ...(folderPath ? { folderPath } : {}),
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { fromEmail: { contains: q, mode: "insensitive" } },
              { textPreview: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      imapUid: true,
      messageId: true,
      subject: true,
      fromName: true,
      fromEmail: true,
      toEmails: true,
      ccEmails: true,
      date: true,
      snippet: true,
      textPreview: true,
      hasAttachments: true,
      attachmentCount: true,
      flags: true,
      size: true,
      aiAnalyzed: true,
      aiCategory: true,
      aiPriority: true,
      aiSummaryShort: true,
      aiSummaryLong: true,
      aiKeywords: true,
      aiRecommendedFolder: true,
      aiRecommendedAction: true,
      aiConfidence: true,
      actionRequired: true,
      createdAt: true,
      updatedAt: true,
      attachments: {
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          imapPartId: true,
          cloudProvider: true,
          cloudPath: true,
          cloudFileId: true,
          savedAt: true,
          saveStatus: true,
          saveError: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  return ok({ emails });
}
