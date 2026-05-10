import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { getOrCreateAutomationSettings, updateAutomationSettings } from "@/server/automation/settings";
import { z } from "zod";

const patchSchema = z.object({
  runOnAppStart: z.boolean().optional(),
  runIntervalMinutes: z.number().int().min(5).max(24 * 60).optional(),
  autoAnalyzeNewEmails: z.boolean().optional(),
  autoApplyUserRules: z.boolean().optional(),
  autoApplyAiSuggestions: z.boolean().optional(),
  aiMinConfidenceForMove: z.number().min(0).max(1).optional(),
  aiMinConfidenceForTrash: z.number().min(0).max(1).optional(),
  aiMinConfidenceForSpam: z.number().min(0).max(1).optional(),
  autoSaveAttachments: z.boolean().optional(),
  mailScrollBatchSize: z.number().int().min(50).max(500).optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const settings = await getOrCreateAutomationSettings(session.userId);
  return ok({ settings });
}

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  try {
    const payload = patchSchema.parse(await req.json());
    const settings = await updateAutomationSettings(session.userId, payload);
    return ok({ settings });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid automation settings", 400);
  }
}
