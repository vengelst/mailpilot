import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";

const localFlagSchema = z.object({
  flag: z.enum(["red", "yellow", "green"]).nullable(),
});

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const id = await resolveId(context.params);
    const body = await req.json().catch(() => null);
    const parsed = localFlagSchema.safeParse(body);
    if (!parsed.success) {
      return fail("Ungültiger Flag-Wert. Erlaubt: red, yellow, green oder null.", 400);
    }

    const email = await prisma.emailIndex.findFirst({
      where: {
        id,
        account: { userId: session.userId },
      },
      select: { id: true, accountId: true, localFlag: true },
    });
    if (!email) return fail("Email not found", 404);

    const updated = await prisma.emailIndex.update({
      where: { id },
      data: { localFlag: parsed.data.flag },
      select: { id: true, localFlag: true },
    });

    await writeAuditLog({
      userId: session.userId,
      accountId: email.accountId,
      emailId: id,
      action: "email.local_flag.set",
      actor: "user",
      beforeJson: { localFlag: email.localFlag },
      afterJson: { localFlag: updated.localFlag },
    });

    return ok({ email: updated });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Lokaler Flag konnte nicht gesetzt werden.", 400);
  }
}
