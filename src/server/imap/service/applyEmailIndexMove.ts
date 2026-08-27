import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

type MoveSource = {
  id: string;
  accountId: string;
  folderPath: string;
  imapUid: bigint;
  messageId: string | null;
};

/**
 * Updates EmailIndex after a successful IMAP move.
 *
 * UIDs are per-mailbox: reusing the source UID in another folder causes
 * unique-constraint collisions. Without UIDPLUS (newUid=null) we drop the
 * source row and let the next sync re-index the message in the target folder.
 */
export async function applyEmailIndexFolderMove(
  email: MoveSource,
  targetFolder: string,
  newUid: bigint | null,
  extraData?: Prisma.EmailIndexUpdateInput,
): Promise<{ keptId: string | null; folderPath: string }> {
  if (
    targetFolder === email.folderPath &&
    (newUid === null || newUid === email.imapUid)
  ) {
    if (extraData && Object.keys(extraData).length > 0) {
      await prisma.emailIndex.update({ where: { id: email.id }, data: extraData });
    }
    return { keptId: email.id, folderPath: targetFolder };
  }

  // Cross-folder without destination UID: cannot safely remap.
  if (newUid === null && targetFolder !== email.folderPath) {
    await prisma.emailIndex.delete({ where: { id: email.id } });
    return { keptId: null, folderPath: targetFolder };
  }

  const uid = newUid ?? email.imapUid;
  const conflict = await prisma.emailIndex.findFirst({
    where: {
      accountId: email.accountId,
      folderPath: targetFolder,
      imapUid: uid,
      NOT: { id: email.id },
    },
    select: { id: true, messageId: true },
  });

  if (conflict) {
    const sameMessage =
      !!conflict.messageId &&
      !!email.messageId &&
      conflict.messageId === email.messageId;

    if (sameMessage) {
      await prisma.$transaction([
        prisma.emailIndex.delete({ where: { id: conflict.id } }),
        prisma.emailIndex.update({
          where: { id: email.id },
          data: {
            folderPath: targetFolder,
            imapUid: uid,
            ...extraData,
          },
        }),
      ]);
      return { keptId: email.id, folderPath: targetFolder };
    }

    // Target UID already taken by another indexed row — IMAP move is done;
    // drop the source index entry to avoid unique constraint failures.
    await prisma.emailIndex.delete({ where: { id: email.id } });
    return { keptId: conflict.id, folderPath: targetFolder };
  }

  await prisma.emailIndex.update({
    where: { id: email.id },
    data: {
      folderPath: targetFolder,
      imapUid: uid,
      ...extraData,
    },
  });
  return { keptId: email.id, folderPath: targetFolder };
}
