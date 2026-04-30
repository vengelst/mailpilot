import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { runAutomationNow } from "@/server/automation/automationRunner";

const schema = z.object({
  type: z.string().min(1).optional(),
  accountId: z.string().optional(),
  emailId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  try {
    const payload = schema.parse(await req.json());
    const run = await runAutomationNow(session.userId, {
      type: payload.type ?? "full",
      accountId: payload.accountId,
      emailId: payload.emailId,
    });
    return ok({ run });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Automation run failed", 400);
  }
}
