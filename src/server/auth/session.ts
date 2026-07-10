/**
 * @module session
 *
 * JWT-based session management for MailPilot.
 * Creates, verifies, and manages session tokens stored as HTTP-only cookies.
 * Uses HS256 symmetric signing with a server-side secret.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "mailpilot_session";

/** Data embedded in every session JWT. */
type SessionPayload = {
  userId: string;
  email: string;
};

/**
 * Reads the SESSION_SECRET env var and encodes it as a Uint8Array
 * suitable for the `jose` signing/verification API.
 */
function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Creates a signed JWT containing the user's id and email.
 * The token is valid for 7 days.
 *
 * @param payload - User identity to embed in the token.
 * @returns The signed JWT string.
 */
export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

/**
 * Verifies a JWT and extracts the session payload.
 * Returns `null` for expired, malformed, or tampered tokens.
 *
 * @param token - The raw JWT string to verify.
 * @returns The decoded session payload, or `null` if verification fails.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    // Guard against unexpected payload shapes (e.g. tokens from other issuers)
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Reads the session cookie from the incoming request and verifies it.
 *
 * @returns The verified session payload, or `null` if no valid session exists.
 */
export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Attaches the session JWT as an HTTP-only cookie on the outgoing response.
 * The cookie expires after 7 days, matching the JWT lifetime.
 *
 * @param response - The NextResponse to attach the cookie to.
 * @param token - The signed JWT string.
 */
export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

/**
 * Removes the session cookie by setting it to an empty value with immediate expiry.
 *
 * @param response - The NextResponse to clear the cookie on.
 */
export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
