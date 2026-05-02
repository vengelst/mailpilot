import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/service";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } });
}
