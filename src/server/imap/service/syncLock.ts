/**
 * Sync concurrency control.
 *
 * SCOPE — INTENTIONALLY SINGLE-PROCESS:
 * This guard prevents two simultaneous sync requests for the same
 * (accountId, folderPath) from clobbering each other within ONE Node.js
 * process. It is a deliberate MVP choice and matches the current production
 * topology (single `mailpilot-app` container behind Nginx, no horizontal
 * scaling).
 *
 * KNOWN LIMITATION:
 * If the deployment ever runs multiple replicas (PM2 cluster mode, multiple
 * containers behind a load balancer, blue/green during a deploy), this lock
 * is per-replica only and does NOT prevent two replicas from syncing the
 * same folder in parallel. In that case the consequences are bounded:
 *   - upserts are idempotent on `(accountId, folderPath, imapUid)`
 *   - flag refresh is convergent
 *   - UIDVALIDITY rebuild deletes only the local index for THAT folder
 *   - no IMAP-side mutation other than `messageMove`/`messageFlagsAdd`
 * so the worst case is wasted work, not data loss.
 *
 * UPGRADE PATH (when needed):
 * Replace `withSyncLock` body with PostgreSQL advisory locks, e.g.
 *   SELECT pg_try_advisory_lock(hashtext($1)::bigint);
 *   ...
 *   SELECT pg_advisory_unlock(hashtext($1)::bigint);
 * Hash key: `${accountId}::${folderPath}`. Held for the duration of the
 * transaction or session. No schema changes required.
 */
const activeSyncs = new Set<string>();
function syncLockKey(accountId: string, folderPath: string) {
  return `${accountId}\x00${folderPath}`;
}
export class SyncBusyError extends Error {
  constructor(accountId: string, folderPath: string) {
    super(`Sync already running for account ${accountId} folder ${folderPath}`);
    this.name = "SyncBusyError";
  }
}
export async function withSyncLock<T>(
  accountId: string,
  folderPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = syncLockKey(accountId, folderPath);
  if (activeSyncs.has(key)) {
    throw new SyncBusyError(accountId, folderPath);
  }
  activeSyncs.add(key);
  try {
    return await fn();
  } finally {
    activeSyncs.delete(key);
  }
}

