import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { attachSession, ensureLocalUser, loginWithEmailPassword } from "@/server/auth/service";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: NextRequest) {
  try {
    const payload = schema.parse(await req.json());
    const usersCount = await prisma.user.count();
    if (usersCount === 0) {
      await ensureLocalUser(payload.email, payload.password);
    }

    const user = await loginWithEmailPassword(payload.email, payload.password);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const res = NextResponse.json({ id: user.id, email: user.email });
    await attachSession(res, user.id, user.email);

    await writeAuditLog({
      userId: user.id,
      action: "auth.login",
      actor: "user",
      afterJson: { email: user.email },
    });

    return res;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Login failed" },
      { status: 400 },
    );
  }
}
