type SyncAllPhase = "preparing" | "running" | "finished" | "failed";
type SyncMode = "incremental" | "full";

export type SyncAllProgressSnapshot = {
  userId: string;
  accountId: string;
  mode: SyncMode;
  phase: SyncAllPhase;
  folderTotal: number;
  folderDone: number;
  totalMails: number;
  processedMails: number;
  remainingMails: number;
  isEstimate: boolean;
  startedAt: string;
  updatedAt: string;
  lastFolderPath: string | null;
  message: string | null;
  error: string | null;
  etaSeconds: number | null;
};

type InternalProgress = Omit<SyncAllProgressSnapshot, "startedAt" | "updatedAt" | "etaSeconds"> & {
  startedAtMs: number;
  updatedAtMs: number;
};

const RETAIN_FINISHED_MS = 5 * 60 * 1000;
const progressByKey = new Map<string, InternalProgress>();

function progressKey(userId: string, accountId: string) {
  return `${userId}\x00${accountId}`;
}

function toSnapshot(state: InternalProgress): SyncAllProgressSnapshot {
  const elapsedSec = Math.max(0, (Date.now() - state.startedAtMs) / 1000);
  const rate = elapsedSec > 0 ? state.processedMails / elapsedSec : 0;
  const etaSeconds =
    state.phase === "running" && state.remainingMails > 0 && rate > 0
      ? Math.max(1, Math.round(state.remainingMails / rate))
      : null;

  return {
    ...state,
    startedAt: new Date(state.startedAtMs).toISOString(),
    updatedAt: new Date(state.updatedAtMs).toISOString(),
    etaSeconds,
  };
}

function cleanupExpired() {
  const now = Date.now();
  for (const [key, value] of progressByKey.entries()) {
    if (value.phase === "finished" || value.phase === "failed") {
      if (now - value.updatedAtMs > RETAIN_FINISHED_MS) {
        progressByKey.delete(key);
      }
    }
  }
}

export function startSyncAllProgress(input: {
  userId: string;
  accountId: string;
  mode: SyncMode;
  message?: string;
}) {
  cleanupExpired();
  const now = Date.now();
  const state: InternalProgress = {
    userId: input.userId,
    accountId: input.accountId,
    mode: input.mode,
    phase: "preparing",
    folderTotal: 0,
    folderDone: 0,
    totalMails: 0,
    processedMails: 0,
    remainingMails: 0,
    isEstimate: true,
    startedAtMs: now,
    updatedAtMs: now,
    lastFolderPath: null,
    message: input.message ?? null,
    error: null,
  };
  progressByKey.set(progressKey(input.userId, input.accountId), state);
}

export function updateSyncAllProgress(
  userId: string,
  accountId: string,
  patch: Partial<Omit<InternalProgress, "userId" | "accountId" | "startedAtMs">>,
) {
  const key = progressKey(userId, accountId);
  const current = progressByKey.get(key);
  if (!current) return;
  const next: InternalProgress = {
    ...current,
    ...patch,
    updatedAtMs: Date.now(),
  };
  next.folderDone = Math.max(0, Math.min(next.folderDone, next.folderTotal));
  next.processedMails = Math.max(0, Math.min(next.processedMails, next.totalMails));
  next.remainingMails = Math.max(0, next.totalMails - next.processedMails);
  progressByKey.set(key, next);
}

export function finishSyncAllProgress(input: {
  userId: string;
  accountId: string;
  phase: "finished" | "failed";
  message?: string;
  error?: string;
}) {
  const key = progressKey(input.userId, input.accountId);
  const current = progressByKey.get(key);
  if (!current) return;
  progressByKey.set(key, {
    ...current,
    phase: input.phase,
    message: input.message ?? current.message,
    error: input.error ?? null,
    remainingMails: Math.max(0, current.totalMails - current.processedMails),
    updatedAtMs: Date.now(),
  });
}

export function getSyncAllProgress(userId: string, accountId: string): SyncAllProgressSnapshot | null {
  cleanupExpired();
  const value = progressByKey.get(progressKey(userId, accountId));
  return value ? toSnapshot(value) : null;
}
