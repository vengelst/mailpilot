import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { buildOauthStartUrl, createOauthState } from "@/server/cloud/oauth";

const schema = z.object({
  provider: z.enum(["google_drive", "onedrive"]),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const parsed = schema.safeParse({
    provider: req.nextUrl.searchParams.get("provider"),
  });
  if (!parsed.success) return fail("Invalid provider", 400);

  const state = createOauthState(parsed.data.provider, session.userId);
  const authUrl = buildOauthStartUrl(parsed.data.provider, state);

  return ok({ authUrl, state });
}
