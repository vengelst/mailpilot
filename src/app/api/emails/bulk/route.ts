import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { writeAuditLog } from "@/server/audit/auditLog";
import { runBulkEmailAction, BulkAction } from "@/server/imap/imapService";

/**
 * Bulk action endpoint — applies one of a fixed whitelist of safe actions
 * to up to 500 emails in a single call.
 *
 * Whitelist (kept narrow on purpose):
 *   - mark_read / mark_unread
 *   - move_trash / move_spam        (IMAP MOVE — never EXPUNGE)
 *   - move_folder                   (IMAP MOVE into an existing folder)
 *
 * `delete` / `expunge` / `permanent_delete` are deliberately NOT supported —
 * permanent deletion lives in `/api/folders/empty` with a separate confirm flow.
 */
const schema = z
  .object({
    action: z.enum([
      "mark_read",
      "mark_unread",
      "move_trash",
      "move_spam",
      "move_folder",
    ]),
    emailIds: z.array(z.string().min(1)).min(1).max(500),
    targetFolder: z.string().min(1).optional(),
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

  await writeAuditLog({
    userId: session.userId,
    action: "email.bulk.started",
    actor: "user",
    afterJson: {
      action: body.action,
      requested: body.emailIds.length,
      targetFolder: body.targetFolder ?? null,
    },
  });

  try {
    const { outcomes } = await runBulkEmailAction({
      userId: session.userId,
      action: body.action as BulkAction,
      emailIds: body.emailIds,
      targetFolder: body.targetFolder,
    });

    const executed = outcomes.filter((o) => o.status === "executed").length;
    const failed = outcomes.filter((o) => o.status === "failed").length;
    const rejected = outcomes.filter((o) => o.status === "rejected").length;

    await writeAuditLog({
      userId: session.userId,
      action: "email.bulk.finished",
      actor: "user",
      afterJson: {
        action: body.action,
        targetFolder: body.targetFolder ?? null,
        requested: body.emailIds.length,
        executed,
        failed,
        rejected,
      },
    });

    return ok({
      summary: {
        requested: body.emailIds.length,
        executed,
        failed,
        rejected,
      },
      results: outcomes.map((o) => ({
        emailId: o.emailId,
        status: o.status,
        ...(o.reason ? { error: o.reason } : {}),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk action failed";
    await writeAuditLog({
      userId: session.userId,
      action: "email.bulk.failed",
      actor: "system",
      afterJson: {
        action: body.action,
        error: message.slice(0, 500),
      },
    });
    return fail(message, 400);
  }
}
