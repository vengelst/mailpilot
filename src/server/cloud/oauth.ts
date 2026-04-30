import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { encryptSecret } from "@/server/security/crypto";
import { prisma } from "@/server/db/prisma";
import { SupportedCloudProvider } from "@/server/cloud/types";

type SupportedOauthProvider = SupportedCloudProvider;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function getStateSigningSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return secret;
}

export function buildOauthStartUrl(provider: SupportedOauthProvider, state: string) {
  if (provider === "google_drive") {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? "missing-google-client-id";
    const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:5600/api/cloud/oauth/callback";
    return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("https://www.googleapis.com/auth/drive.file")}&state=${encodeURIComponent(state)}&access_type=offline&prompt=consent`;
  }

  const clientId = process.env.ONEDRIVE_CLIENT_ID ?? "missing-onedrive-client-id";
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI ?? "http://localhost:5600/api/cloud/oauth/callback";
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("Files.ReadWrite offline_access User.Read")}&state=${encodeURIComponent(state)}`;
}

export function createOauthState(provider: SupportedOauthProvider, userId: string) {
  const payload = {
    provider,
    userId,
    nonce: randomUUID(),
    iat: Date.now(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getStateSigningSecret())
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function parseOauthState(state: string) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = createHmac("sha256", getStateSigningSecret())
    .update(encodedPayload)
    .digest("base64url");

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      provider?: unknown;
      userId?: unknown;
      iat?: unknown;
    };
    if (parsed.provider !== "google_drive" && parsed.provider !== "onedrive") return null;
    if (typeof parsed.userId !== "string" || !parsed.userId) return null;
    if (typeof parsed.iat !== "number") return null;
    if (Date.now() - parsed.iat > OAUTH_STATE_TTL_MS) return null;
    return { provider: parsed.provider as SupportedOauthProvider, userId: parsed.userId };
  } catch {
    return null;
  }
}

export async function upsertCloudAccountFromCallback(input: {
  provider: SupportedOauthProvider;
  userId: string;
  code: string;
}): Promise<{ id: string; provider: SupportedOauthProvider }> {
  const allowStub = process.env.CLOUD_OAUTH_ALLOW_STUB === "true";
  if (!allowStub) {
    throw new Error(
      "OAuth token exchange is not configured. Enable CLOUD_OAUTH_ALLOW_STUB=true only for local testing.",
    );
  }

  // Stub exchange for local development only (see CLOUD_OAUTH_ALLOW_STUB).
  const accessToken = `token_${input.provider}_${input.code}`;
  const refreshToken = `refresh_${input.provider}_${input.code}`;
  const encryptedAccessToken = encryptSecret(accessToken);
  const encryptedRefreshToken = encryptSecret(refreshToken);

  const prismaAny = prisma as unknown as {
    cloudAccount: {
      findFirst: (args: unknown) => Promise<{ id: string } | null>;
      update: (args: unknown) => Promise<{ id: string; provider: SupportedOauthProvider }>;
      create: (args: unknown) => Promise<{ id: string; provider: SupportedOauthProvider }>;
    };
  };

  const existing = await prismaAny.cloudAccount.findFirst({
    where: { userId: input.userId, provider: input.provider },
  });

  if (existing) {
    return prismaAny.cloudAccount.update({
      where: { id: existing.id },
      data: {
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000),
      },
    });
  }

  return prismaAny.cloudAccount.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      displayName: input.provider === "google_drive" ? "Google Drive" : "OneDrive",
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000),
    },
  });
}
