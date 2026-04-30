import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import {
  getOrCreateSignatureSettings,
  updateSignatureSettings,
} from "@/server/signature/settings";

const patchSchema = z.object({
  signatureText: z.string().max(10000).optional(),
  includeOnNewMail: z.boolean().optional(),
  includeOnReply: z.boolean().optional(),
  includeOnForward: z.boolean().optional(),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  const settings = await getOrCreateSignatureSettings(session.userId);
  return ok({ settings });
}

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);
  try {
    const payload = patchSchema.parse(await req.json());
    const settings = await updateSignatureSettings(session.userId, payload);
    return ok({ settings });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid signature settings", 400);
  }
}
