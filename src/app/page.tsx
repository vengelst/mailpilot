import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/server/auth/session";

export default async function Home() {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("/login");
  }
  redirect("/mail");
}
