import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { updateAutomationSettings } from "@/server/automation/settings";
import { z } from "zod";

const schema = z.object({
  runOnAppStart: z.boolean().optional(),
  runIntervalMinutes: z.number().int().min(5).max(24 * 60).optional(),
});

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  try {
    const payload = schema.parse(await req.json());
    const settings = await updateAutomationSettings(session.userId, payload);
    return ok({ settings });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid schedule payload", 400);
  }
}
