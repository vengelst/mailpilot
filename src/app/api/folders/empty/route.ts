import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";
import { emptyTrashOrSpamFolder } from "@/server/imap/imapService";

/**
 * Permanent-delete endpoint — empties the user's Trash or Spam folder.
 *
 * Strict guards:
 *   - Auth required.
 *   - Account must belong to the user.
 *   - Folder must classify as trash or spam (special-use flag or path
 *     pattern). Regular folders are rejected with 400 — there is no way
 *     to coerce this endpoint into purging INBOX.
 *   - `confirm: true` (or `confirmText: "LEEREN"`) is mandatory.
 *   - Triggers `purgeFolderMessages` (the single EXPUNGE site in the codebase).
 */
const schema = z
  .object({
    accountId: z.string().min(1),
    folderPath: z.string().min(1),
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json().catch(() => ({})));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      return fail(
        `Ungültige Eingabe (${first?.path?.join(".") || "body"}): ${first?.message ?? ""}`,
        400,
      );
    }
    return fail("Invalid payload", 400);
  }

  if (body.confirm !== true && body.confirmText !== "LEEREN") {
    return fail(
      "Bestätigung erforderlich. Setze confirm: true oder confirmText: 'LEEREN'.",
      400,
    );
  }

  // Ownership check before we go anywhere near IMAP.
  const account = await prisma.mailAccount.findFirst({
    where: { id: body.accountId, userId: session.userId },
    select: { id: true },
  });
  if (!account) return fail("Account not found", 404);

  await writeAuditLog({
    userId: session.userId,
    accountId: body.accountId,
    action: "folder.empty.started",
    actor: "user",
    afterJson: { accountId: body.accountId, folderPath: body.folderPath },
  });

  try {
    const result = await emptyTrashOrSpamFolder({
      accountId: body.accountId,
      userId: session.userId,
      folderPath: body.folderPath,
    });

    await writeAuditLog({
      userId: session.userId,
      accountId: body.accountId,
      action: "folder.empty.finished",
      actor: "user",
      afterJson: {
        accountId: body.accountId,
        folderPath: body.folderPath,
        kind: result.kind,
        count: result.deleted,
      },
    });

    return ok({
      accountId: body.accountId,
      folderPath: body.folderPath,
      kind: result.kind,
      deleted: result.deleted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Empty folder failed";
    await writeAuditLog({
      userId: session.userId,
      accountId: body.accountId,
      action: "folder.empty.failed",
      actor: "system",
      afterJson: {
        accountId: body.accountId,
        folderPath: body.folderPath,
        error: message.slice(0, 500),
      },
    });
    return fail(message, 400);
  }
}
