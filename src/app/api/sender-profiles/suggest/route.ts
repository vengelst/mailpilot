import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import {
  suggestProfileName,
  suggestPatterns,
} from "@/server/rules/senderMatcher";

const schema = z.object({
  email: z.string().min(1),
  fromName: z.string().default(""),
});

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const { email, fromName } = schema.parse(await req.json());

    return ok({
      profileName: suggestProfileName(fromName, email),
      patterns: suggestPatterns(email),
    });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Vorschlag fehlgeschlagen",
      400,
    );
  }
}
