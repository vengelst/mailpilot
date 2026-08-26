/**
 * Sync and data-loading hook for the mail workspace. Handles loading accounts,
 * folders, emails, email bodies, automation settings/runs, labels, signatures,
 * contact candidates, and all sync operations (inbox, all-folders, idle).
 */

import { useRouter } from "next/navigation";
import {
  type Account,
  type AutomationRunSummary,
  type Email,
  type Folder,
  type LabelDef,
  type SignatureData,
  readErrorMessage,
  snapMailScrollBatchSize,
} from "./mail-types";
import type { MailStateReturn } from "./use-mail-state";

export function useMailSync(s: MailStateReturn) {
  const router = useRouter();

  function mailListSearchParams(cursor: string | null) {
    const params = new URLSearchParams();
    if (s.selectedAccountId && !s.isAllAccounts) {
      params.set("accountId", s.selectedAccountIdRef.current || s.selectedAccountId);
      params.set("folder", s.selectedFolderPathRef.current || s.selectedFolderPath);
    }
    params.set("sort", s.sort);
    params.set("limit", String(s.mailScrollBatchSize));
    if (s.query.trim()) params.set("q", s.query.trim());
    if (s.hasAttachmentsFilter) params.set("hasAttachments", "true");
    if (s.actionRequiredFilter) params.set("actionRequired", "true");
    if (s.localFlagFilter !== "all") params.set("localFlag", s.localFlagFilter);
    if (s.tab === "unread") params.set("isRead", "false");
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function loadAccounts() {
    const res = await fetch("/api/accounts");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "Konten konnten nicht geladen werden."));
      return;
    }
    const data = await res.json();
    const next: Account[] = data.accounts ?? [];
    s.setAccounts(next);
    if (!next.length) {
      s.setSelectedAccountId("");
      s.setSelectedFolderPath("");
      s.setMoveTargetFolder("");
      s.setFolders([]);
      s.setEmails([]);
      s.setSelectedEmail(null);
      return;
    }
    if (!next.some((a) => a.id === s.selectedAccountId)) {
      const defaultAccount = next.find((a) => a.isDefault);
      s.setSelectedAccountId(defaultAccount ? defaultAccount.id : next[0].id);
    }
  }

  async function loadFolders(accountId: string, options?: { fromImap?: boolean }) {
    if (!accountId) return;
    const qs = options?.fromImap ? "?sync=1" : "";
    const res = await fetch(`/api/accounts/${accountId}/folders${qs}`);
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "Ordner konnten nicht geladen werden."));
      s.setFolders([]);
      return;
    }
    const data = await res.json();
    const next: Folder[] = data.folders ?? [];
    s.setFolders(next);
    if (!next.length) {
      s.setSelectedFolderPath("");
    } else if (!next.some((f) => f.path === s.selectedFolderPathRef.current)) {
      s.setSelectedFolderPath(next[0].path);
    }
    s.setMoveTargetFolder(next[0]?.path ?? "");
  }

  async function reloadFolders() {
    if (s.selectedAccountId && !s.isAllAccounts) {
      await loadFolders(s.selectedAccountId, { fromImap: true });
    }
  }

  async function loadEmails() {
    const requestId = ++s.activeLoadEmailsRequestIdRef.current;
    if (!s.selectedAccountId || (!s.isAllAccounts && !s.selectedFolderPath)) {
      if (requestId === s.activeLoadEmailsRequestIdRef.current) {
        s.setEmails([]);
        s.setSelectedEmail(null);
        s.emailsNextCursorRef.current = null;
        s.emailsHasMoreRef.current = false;
        s.setEmailsHasMore(false);
      }
      return [] as Email[];
    }
    s.isLoadingEmailsRef.current = true;
    if (requestId === s.activeLoadEmailsRequestIdRef.current) {
      s.setIsLoadingEmails(true);
      s.setUiError("");
      s.emailsNextCursorRef.current = null;
      s.emailsHasMoreRef.current = false;
      s.setEmailsHasMore(false);
    }

    const res = await fetch(`/api/search?${mailListSearchParams(null).toString()}`);
    if (requestId !== s.activeLoadEmailsRequestIdRef.current) return [] as Email[];
    if (!res.ok) {
      s.setUiError(await readErrorMessage(res, "E-Mails konnten nicht geladen werden."));
      s.setEmails([]);
      s.setSelectedEmail(null);
      s.isLoadingEmailsRef.current = false;
      s.setIsLoadingEmails(false);
      return [] as Email[];
    }

    const data = (await res.json()) as {
      emails?: Email[];
      pageInfo?: { nextCursor?: string | null; hasMore?: boolean };
    };
    if (requestId !== s.activeLoadEmailsRequestIdRef.current) return [] as Email[];
    const nextEmails: Email[] = data.emails ?? [];
    const pageInfo = data.pageInfo;
    s.emailsNextCursorRef.current = pageInfo?.nextCursor ?? null;
    s.emailsHasMoreRef.current = pageInfo?.hasMore ?? false;
    s.setEmailsHasMore(pageInfo?.hasMore ?? false);
    s.setEmails(nextEmails);
    if (!nextEmails.length) {
      s.setSelectedEmail(null);
    } else if (s.selectedEmail && !nextEmails.some((e) => e.id === s.selectedEmail!.id)) {
      s.setSelectedEmail(null);
      s.setMobilePane("middle");
      s.setEmailDetailMenuOpen(false);
    }
    s.isLoadingEmailsRef.current = false;
    s.setIsLoadingEmails(false);
    return nextEmails;
  }

  async function loadMoreEmails() {
    const cursor = s.emailsNextCursorRef.current;
    if (
      !s.emailsHasMoreRef.current ||
      !cursor ||
      s.loadMoreInFlightRef.current ||
      s.isLoadingEmailsRef.current
    ) {
      return;
    }
    if (!s.selectedAccountId || (!s.isAllAccounts && !s.selectedFolderPath)) return;
    s.loadMoreInFlightRef.current = true;
    s.setIsLoadingMoreEmails(true);
    s.setUiError("");
    try {
      const res = await fetch(`/api/search?${mailListSearchParams(cursor).toString()}`);
      if (!res.ok) {
        s.setUiError(await readErrorMessage(res, "Weitere E-Mails konnten nicht geladen werden."));
        return;
      }
      const data = (await res.json()) as {
        emails?: Email[];
        pageInfo?: { nextCursor?: string | null; hasMore?: boolean };
      };
      const more = data.emails ?? [];
      const pageInfo = data.pageInfo;
      s.setEmails((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const merged = [...prev];
        for (const e of more) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            merged.push(e);
          }
        }
        return merged;
      });
      s.emailsNextCursorRef.current = pageInfo?.nextCursor ?? null;
      s.emailsHasMoreRef.current = pageInfo?.hasMore ?? false;
      s.setEmailsHasMore(pageInfo?.hasMore ?? false);
    } finally {
      s.loadMoreInFlightRef.current = false;
      s.setIsLoadingMoreEmails(false);
    }
  }

  async function loadBody(id: string, force?: boolean) {
    s.setIsLoadingBody(true);
    s.setBodyError("");
    s.setShowExternalImages(false);
    try {
      const url = `/api/emails/${id}/body${force ? "?refresh=1" : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        s.setBodyError(
          (data as { error?: string }).error ?? "Mailinhalt konnte nicht geladen werden.",
        );
        s.setBodyContent(null);
        return;
      }
      const data = (await res.json()) as {
        body?: { text?: string; html?: string; textFromHtml?: string; cached?: boolean };
      };
      const text = data.body?.text || data.body?.textFromHtml || "";
      const html = data.body?.html || "";

      if (!html && !text && !force) {
        return loadBody(id, true);
      }

      if (s.activeLoadEmailRequestIdRef.current > 0) {
        s.setBodyContent({ text, html });
        s.setBodyMode(html ? "html" : text ? "text" : "text");
      }
    } catch (error) {
      s.setBodyError(error instanceof Error ? error.message : "Mailinhalt konnte nicht geladen werden.");
      s.setBodyContent(null);
    } finally {
      s.setIsLoadingBody(false);
    }
  }

  async function loadEmail(id: string) {
    if (s.pendingAutoMoveRef.current && s.pendingAutoMoveRef.current.emailId !== id) {
      const { emailId: moveId, folder } = s.pendingAutoMoveRef.current;
      s.pendingAutoMoveRef.current = null;
      s.setEmails((prev) => prev.filter((e) => e.id !== moveId));
      if (s.autoMoveToastTimerRef.current) clearTimeout(s.autoMoveToastTimerRef.current);
      s.setAutoMoveToast({ emailId: moveId, folder });
      s.autoMoveToastTimerRef.current = setTimeout(() => {
        s.setAutoMoveToast(null);
        s.autoMoveToastTimerRef.current = null;
      }, 5000);
      void reloadFolders();
    }
    const requestId = ++s.activeLoadEmailRequestIdRef.current;
    s.setIsLoadingDetail(true);
    s.setEmailDetailMenuOpen(false);
    s.setAttachmentPreviewOpen(new Set());
    s.setBodyContent(null);
    s.setBodyError("");
    s.setBodyMode("html");
    s.setIsBodyMaximized(false);
    s.setShowExternalImages(false);
    s.setIsLoadingBody(true);
    const res = await fetch(`/api/emails/${id}`);
    if (requestId !== s.activeLoadEmailRequestIdRef.current) return;
    if (!res.ok) {
      s.setUiError("E-Mail konnte nicht geladen werden.");
      s.setSelectedEmail(null);
      s.setEmailDetailMenuOpen(false);
      s.setIsLoadingDetail(false);
      s.setIsLoadingBody(false);
      return;
    }
    const data = await res.json();
    if (requestId !== s.activeLoadEmailRequestIdRef.current) return;
    const emailData = data.email ?? null;
    s.setSelectedEmail(emailData);
    s.setMobilePane("right");
    s.setIsLoadingDetail(false);
    loadContactCandidates().catch(() => {});
    await loadBody(id);
    if (requestId !== s.activeLoadEmailRequestIdRef.current) return;
    if (emailData) {
      const unread = !(emailData.flags ?? []).includes("\\Seen");
      const isInInbox = emailData.folderPath === "INBOX";
      if (unread || isInInbox) {
        fetch(`/api/emails/${id}/mark-read`, { method: "POST" })
          .then(async (res) => {
            if (!res.ok) return;
            const mrData = await res.json().catch(() => ({}));
            if (mrData.movedTo) {
              s.pendingAutoMoveRef.current = { emailId: id, folder: mrData.movedTo };
            }
            if (Array.isArray(mrData.labels) && mrData.labels.length > 0) {
              const newLabels = mrData.labels as string[];
              s.setSelectedEmail((prev: Email | null) =>
                prev?.id === id ? { ...prev, labels: newLabels } : prev,
              );
              s.setEmails((prev) =>
                prev.map((e) => (e.id === id ? { ...e, labels: newLabels } : e)),
              );
              void loadLabels();
            }
          })
          .catch(() => {});
      }
      if (unread) {
        s.setSelectedEmail((prev: Email | null) =>
          prev?.id === id ? { ...prev, flags: [...(prev.flags ?? []), "\\Seen"] } : prev,
        );
        s.setEmails((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, flags: [...(e.flags ?? []), "\\Seen"] } : e,
          ),
        );
      }
      // Restore Auto-Prompt: classify unknown senders when opening a mail
      s.onEmailOpenedRef.current?.(emailData);
    }
    return emailData;
  }

  async function loadContactCandidates() {
    const res = await fetch("/api/contact-candidates");
    if (!res.ok) return;
    const data = await res.json();
    s.setContactCandidates(data.candidates ?? []);
  }

  async function loadSignatureSettings() {
    const res = await fetch("/api/signatures");
    if (!res.ok) return;
    const data = (await res.json()) as { signatures?: SignatureData[] };
    if (data.signatures) s.setSignatures(data.signatures);
  }

  async function loadAutomationSettings() {
    const res = await fetch("/api/automation/settings");
    if (!res.ok) return;
    const data = (await res.json()) as {
      settings?: {
        runOnAppStart?: boolean;
        runIntervalMinutes?: number;
        mailScrollBatchSize?: number;
      };
    };
    const runOnStart = data.settings?.runOnAppStart;
    if (typeof runOnStart === "boolean") s.setRunOnAppStart(runOnStart);
    const interval = data.settings?.runIntervalMinutes;
    if (typeof interval === "number" && Number.isFinite(interval) && interval >= 5) {
      s.setNewMailCheckIntervalMinutes(interval);
    }
    const batch = data.settings?.mailScrollBatchSize;
    if (typeof batch === "number" && Number.isFinite(batch)) {
      s.setMailScrollBatchSize(snapMailScrollBatchSize(batch));
    }
  }

  async function loadAutomationRuns() {
    const res = await fetch("/api/automation/runs");
    if (!res.ok) return;
    const data = (await res.json()) as { runs?: AutomationRunSummary[] };
    s.setAutomationRuns((data.runs ?? []).slice(0, 5));
  }

  async function loadLabels() {
    try {
      const res = await fetch("/api/labels");
      if (!res.ok) return;
      const data = await res.json();
      s.setLabelList((data.labels ?? []) as LabelDef[]);
    } catch { /* ignore */ }
  }

  async function loadEmailsByLabel(label: string) {
    s.setSelectedLabel(label);
    s.setSelectedEmail(null);
    s.setIsLoadingEmails(true);
    try {
      const res = await fetch(`/api/emails/by-label?label=${encodeURIComponent(label)}&limit=${s.mailScrollBatchSize}`);
      if (!res.ok) {
        s.setUiError("E-Mails für Label konnten nicht geladen werden.");
        s.setEmails([]);
        return;
      }
      const data = await res.json();
      s.setEmails(data.emails ?? []);
      const pageInfo = data.pageInfo;
      s.emailsNextCursorRef.current = pageInfo?.nextCursor ?? null;
      s.emailsHasMoreRef.current = pageInfo?.hasMore ?? false;
      s.setEmailsHasMore(pageInfo?.hasMore ?? false);
    } catch {
      s.setUiError("Label-Ansicht konnte nicht geladen werden.");
    } finally {
      s.setIsLoadingEmails(false);
    }
  }

  async function syncInboxOnly() {
    const accountId = s.selectedAccountIdRef.current;
    if (!accountId || accountId === "__all__") return;
    try {
      const res = await fetch(`/api/accounts/${accountId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: "INBOX", mode: "incremental" }),
      });
      if (!res.ok) return;
      if (s.selectedFolderPathRef.current === "INBOX") {
        await loadEmails();
      }
      await reloadFolders();
    } catch {
      // Silent fail für Auto-Sync
    }
  }

  async function syncAllFolders(trigger: "manual" | "auto" = "manual") {
    if (!s.selectedAccountId || s.isAllAccounts) return;
    const accountId = s.selectedAccountId;
    if (
      trigger === "manual" &&
      !window.confirm(
        "Alle Ordner und Unterordner werden inkrementell synchronisiert (nur Header). Bei vielen Ordnern kann das dauern. Fortfahren?",
      )
    ) {
      return;
    }
    try {
      s.setIsSyncing(true);
      s.setSyncProgress({
        kind: "all_folders",
        label:
          trigger === "auto"
            ? "Automatischer Delta-Sync (alle Ordner) läuft …"
            : "Synchronisiere alle Ordner (Delta) …",
        totalMails: 0,
        processedMails: 0,
        remainingMails: 0,
        etaSeconds: null,
        isEstimate: true,
        lastFolderPath: null,
      });
      s.setUiInfo("");
      s.setUiError("");
      if (typeof window !== "undefined" && s.syncAllProgressPollRef.current !== null) {
        window.clearInterval(s.syncAllProgressPollRef.current);
        s.syncAllProgressPollRef.current = null;
      }
      if (typeof window !== "undefined") {
        s.syncAllProgressPollRef.current = window.setInterval(() => {
          void (async () => {
            try {
              const progressRes = await fetch(
                `/api/accounts/${accountId}/sync-all-folders?request=progress`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ mode: "incremental" }),
                },
              );
              if (!progressRes.ok) return;
              const payload = (await progressRes.json()) as {
                progress?: {
                  totalMails?: number;
                  processedMails?: number;
                  remainingMails?: number;
                  etaSeconds?: number | null;
                  isEstimate?: boolean;
                  phase?: "preparing" | "running" | "finished" | "failed";
                  lastFolderPath?: string | null;
                } | null;
              };
              const progress = payload.progress;
              if (!progress) return;
              s.setSyncProgress((prev) => {
                if (!prev || prev.kind !== "all_folders") return prev;
                const phaseLabel =
                  progress.phase === "preparing"
                    ? "Synchronisation wird vorbereitet …"
                    : progress.phase === "finished"
                      ? "Synchronisation abgeschlossen"
                      : progress.phase === "failed"
                        ? "Synchronisation fehlgeschlagen"
                        : trigger === "auto"
                          ? "Automatischer Delta-Sync (alle Ordner) läuft …"
                          : "Synchronisiere alle Ordner (Delta) …";
                return {
                  ...prev,
                  label: phaseLabel,
                  totalMails: progress.totalMails ?? prev.totalMails,
                  processedMails: progress.processedMails ?? prev.processedMails,
                  remainingMails: progress.remainingMails ?? prev.remainingMails,
                  etaSeconds: progress.etaSeconds ?? null,
                  isEstimate: progress.isEstimate ?? prev.isEstimate,
                  lastFolderPath: progress.lastFolderPath ?? null,
                };
              });
            } catch {
              // ignore polling hiccups
            }
          })();
        }, 1200);
      }
      const res = await fetch(`/api/accounts/${accountId}/sync-all-folders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "incremental" }),
      });
      if (!res.ok) {
        const fallback =
          trigger === "auto"
            ? "Automatischer Delta-Sync (alle Ordner) fehlgeschlagen."
            : "Alle-Ordner-Sync fehlgeschlagen.";
        s.setUiError(await readErrorMessage(res, fallback));
        return;
      }
      const data = (await res.json()) as {
        folderCount: number;
        totalNew: number;
        totalFlagsUpdated: number;
        totalRemoved: number;
        perFolder?: Array<{ skipped?: "busy" | "error" }>;
      };
      const skipped = data.perFolder?.filter((p) => p.skipped).length ?? 0;
      if (trigger === "manual") {
        s.setUiInfo(
          `Alle-Ordner-Sync: ${data.folderCount} Ordner verarbeitet` +
            (skipped > 0 ? `, ${skipped} übersprungen` : "") +
            `, ${data.totalNew} neue Mails, ${data.totalFlagsUpdated} Flag-Änderungen` +
            (data.totalRemoved > 0 ? `, ${data.totalRemoved} aus Index entfernt` : "") +
            ".",
        );
      }
      await loadEmails();
      await reloadFolders();
    } finally {
      if (typeof window !== "undefined" && s.syncAllProgressPollRef.current !== null) {
        window.clearInterval(s.syncAllProgressPollRef.current);
        s.syncAllProgressPollRef.current = null;
      }
      s.setSyncProgress(null);
      s.setIsSyncing(false);
    }
  }

  async function checkNow() {
    if (!s.selectedAccountId || s.isAllAccounts) return;
    s.setIsSyncing(true);
    s.setSyncProgress({
      kind: "all_folders",
      label: "Inbox-Check läuft …",
      totalMails: 0,
      processedMails: 0,
      remainingMails: 0,
      etaSeconds: null,
      isEstimate: true,
      lastFolderPath: "INBOX",
    });
    try {
      const res = await fetch(`/api/accounts/${s.selectedAccountId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: "INBOX", mode: "incremental" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        s.setUiError((data as { error?: string }).error ?? "Inbox-Check fehlgeschlagen.");
      } else {
        s.setUiInfo("Inbox-Check abgeschlossen.");
        if (s.selectedFolderPathRef.current === "INBOX") {
          await loadEmails();
        }
        await reloadFolders();
      }
    } catch (e) {
      s.setUiError(e instanceof Error ? e.message : "Inbox-Check fehlgeschlagen.");
    } finally {
      s.setIsSyncing(false);
      s.setSyncProgress(null);
    }
  }

  return {
    loadAccounts,
    loadFolders,
    reloadFolders,
    loadEmails,
    loadMoreEmails,
    loadBody,
    loadEmail,
    loadContactCandidates,
    loadSignatureSettings,
    loadAutomationSettings,
    loadAutomationRuns,
    loadLabels,
    loadEmailsByLabel,
    syncInboxOnly,
    syncAllFolders,
    checkNow,
  };
}

export type MailSyncReturn = ReturnType<typeof useMailSync>;
