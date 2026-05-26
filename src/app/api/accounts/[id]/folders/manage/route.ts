import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import {
  copyFolderForAccount,
  createFolderForAccount,
  deleteFolderForAccount,
  renameFolderForAccount,
} from "@/server/imap/imapService";

async function resolveId(params: Promise<{ id: string }>) {
  return (await params).id;
}

type ManageFolderBody =
  | { action: "create"; path: string }
  | { action: "delete"; path: string }
  | { action: "rename"; fromPath: string; toPath: string }
  | { action: "copy"; fromPath: string; toPath: string };

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const accountId = await resolveId(context.params);
    const body = (await req.json()) as ManageFolderBody;

    if (body.action === "create") {
      const folders = await createFolderForAccount({
        accountId,
        userId: session.userId,
        folderPath: body.path,
      });
      return ok({ folders });
    }

    if (body.action === "delete") {
      const folders = await deleteFolderForAccount({
        accountId,
        userId: session.userId,
        folderPath: body.path,
      });
      return ok({ folders });
    }

    if (body.action === "rename") {
      const folders = await renameFolderForAccount({
        accountId,
        userId: session.userId,
        fromPath: body.fromPath,
        toPath: body.toPath,
      });
      return ok({ folders });
    }

    if (body.action === "copy") {
      const folders = await copyFolderForAccount({
        accountId,
        userId: session.userId,
        fromPath: body.fromPath,
        toPath: body.toPath,
      });
      return ok({ folders });
    }

    return fail("Unsupported action", 400);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Folder action failed", 400);
  }
}

