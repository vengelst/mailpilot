import { prisma } from "@/server/db/prisma";
import { decryptSecret } from "@/server/security/crypto";
import { testImapConnection } from "@/server/imap/imapClient";

/**
 * Resolves and decrypts the IMAP connection configuration for a mail account.
 *
 * @param accountId - The database ID of the mail account.
 * @param userId - The owning user's ID (used for access control).
 * @returns The raw account record and a ready-to-use IMAP config with decrypted password.
 * @throws If the account does not exist or does not belong to the user.
 */
export async function getAccountConfig(accountId: string, userId: string) {
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) {
    throw new Error("Mail account not found");
  }

  return {
    account,
    config: {
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      username: account.imapUsername,
      password: decryptSecret(account.encryptedImapPassword),
    },
  };
}

/**
 * Tests whether the IMAP server is reachable with the stored credentials.
 *
 * @param accountId - The database ID of the mail account.
 * @param userId - The owning user's ID.
 * @returns The connection test result from the low-level IMAP client.
 */
export async function testAccountConnection(accountId: string, userId: string) {
  const { config } = await getAccountConfig(accountId, userId);
  return testImapConnection(config);
}

