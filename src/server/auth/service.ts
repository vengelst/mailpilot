/**
 * @module auth/service
 *
 * High-level authentication service for MailPilot.
 * Provides user lookup, login, registration, and request-level auth guards.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { createSessionToken, getSessionFromCookies, setSessionCookie } from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";

/**
 * Resolves the currently authenticated user from the session cookie.
 *
 * @returns The full User record, or `null` if not authenticated.
 */
export async function requireUser() {
  const session = await getSessionFromCookies();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
}

/**
 * Same as {@link requireUser}, but additionally checks that the user
 * has the "administrator" role.
 *
 * @returns The admin User record, or `null` if not an admin or not authenticated.
 */
export async function requireAdminUser() {
  const user = await requireUser();
  if (!user || user.role !== "administrator") return null;
  return user;
}

/**
 * Finds an existing user by email or creates a new local account.
 * The very first user in the database is automatically promoted to administrator.
 *
 * @param email - Email address for the account.
 * @param password - Plain-text password (will be hashed before storage).
 * @returns The existing or newly created User record.
 */
export async function ensureLocalUser(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const usersCount = await prisma.user.count();
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      // First user becomes admin; subsequent users get the default role
      role: usersCount === 0 ? "administrator" : "user",
    },
  });
}

/**
 * Authenticates a user by email and password.
 *
 * @param email - The user's email address.
 * @param password - The plain-text password to verify.
 * @returns The User record on success, or `null` if credentials are invalid.
 */
export async function loginWithEmailPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;
  return user;
}

/**
 * Wraps an API route handler with session-based authentication.
 * Returns 401 if no valid session exists; otherwise delegates to the handler.
 *
 * @param handler - The route handler to protect.
 * @param req - The incoming Next.js request.
 * @returns The handler's response, or a 401 JSON error.
 */
export async function withAuth(
  handler: (req: NextRequest, userId: string) => Promise<NextResponse>,
  req: NextRequest,
) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handler(req, session.userId);
}

/**
 * Creates a new session token and attaches it as a cookie on the response.
 *
 * @param response - The outgoing NextResponse.
 * @param userId - The authenticated user's ID.
 * @param email - The authenticated user's email.
 */
export async function attachSession(response: NextResponse, userId: string, email: string) {
  const token = await createSessionToken({ userId, email });
  setSessionCookie(response, token);
}
