import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/server/auth/session";
import { MailWorkspace } from "@/components/mail/mail-workspace";

export default async function MailPage() {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("/login");
  }
  return <MailWorkspace />;
}
