import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { createSessionToken, getSessionFromCookies, setSessionCookie } from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";

export async function requireUser() {
  const session = await getSessionFromCookies();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
}

export async function requireAdminUser() {
  const user = await requireUser();
  if (!user || user.role !== "administrator") return null;
  return user;
}

export async function ensureLocalUser(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const usersCount = await prisma.user.count();
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: usersCount === 0 ? "administrator" : "user",
    },
  });
}

export async function loginWithEmailPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;
  return user;
}

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

export async function attachSession(response: NextResponse, userId: string, email: string) {
  const token = await createSessionToken({ userId, email });
  setSessionCookie(response, token);
}
