"use client";

/**
 * Main component shell for the mail workspace. Composes the three-pane layout
 * (folder sidebar, email list, detail view) using extracted hooks and
 * sub-components. Contains all useEffect orchestration, layout logic, and
 * top-level event handlers.
 */

import {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import { buildSafeMailDocument } from "@/lib/sanitizeMailHtml";
import { linkifyMailPlainText } from "@/lib/linkifyMailPlainText";
import { EmailDetailModal } from "@/components/mail/email-detail-modal";
import { ThemeToggle } from "@/components/theme-toggle";

import {
  type MobileSwipeAction,
  clamp,
  folderDisplayName,
  formatDateTime,
  formatRelative,
  formatStatusBadge,
  senderDisplayName,
} from "./mail-types";
import { useMailState } from "./use-mail-state";
import { useMailSync } from "./use-mail-sync";
import { useMailActions } from "./use-mail-actions";
import { MailList } from "./mail-list";
import { MailDetail } from "./mail-detail";
import { MailCompose } from "./mail-compose";
import { MailContextMenu } from "./mail-context-menu";

// ---- Layout constants (column resize) ----

const FOLDER_WIDTH_MIN = 220;
const FOLDER_WIDTH_MAX = 460;
const LIST_WIDTH_MIN = 320;
const LIST_WIDTH_MAX = 700;
const FOLDER_LS_KEY = "mailpilot.layout.folderWidth";
const LIST_LS_KEY = "mailpilot.layout.listWidth";
const MOBILE_MAIN_HEADER_LS_KEY = "mailpilot.layout.mobileMainHeaderExpanded";
const FOLDER_COUNT_MODE_LS_KEY = "mailpilot.layout.folderCountMode";
const MOBILE_SWIPE_LEFT_ACTION_LS_KEY = "mailpilot.mobileSwipe.leftAction";
const MOBILE_SWIPE_RIGHT_ACTION_LS_KEY = "mailpilot.mobileSwipe.rightAction";
const FOLDER_REFRESH_INTERVAL_MS = 60 * 1000;
const IDLE_FULL_SYNC_MS = 10 * 60 * 1000;

// ---- ResizeHandle ----

type ResizeHandleProps = {
  onDrag: (deltaX: number) => void;
  ariaLabel: string;
};

function ResizeHandle({ onDrag, ariaLabel }: ResizeHandleProps) {
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      if (dx !== 0) onDrag(dx);
    }
    function onUp(ev: PointerEvent) {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      className="hidden w-1 shrink-0 cursor-col-resize glass-resize-handle lg:block"
    />
  );
}

// ===========================================================================
// Main component
// ===========================================================================

export function MailWorkspace() {
  const s = useMailState();
  const sync = useMailSync(s);
  const actions = useMailActions(s, sync);

  // -- Derived convenience aliases (used only in JSX below) --

  const safeMailDocument = useMemo(
    () =>
      s.bodyContent?.html
        ? buildSafeMailDocument(s.bodyContent.html, { allowExternalImages: s.showExternalImages })
        : "",
    [s.bodyContent, s.showExternalImages],
  );

  // -- Mobile gesture handlers --

  function openMobilePane(nextPane: "left" | "middle" | "right") {
    if (nextPane === "right" && !s.hasSelectedEmail) {
      s.setMobilePane("middle");
      return;
    }
    if (nextPane === "left") s.setFoldersOpen(true);
    s.setMobilePane(nextPane);
  }

  function handleDrawerGestureStart(e: ReactTouchEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-mail-row-swipe]")) return;
    const touch = e.touches[0];
    if (!touch) return;
    s.mobileDrawerGestureRef.current = { x: touch.clientX, y: touch.clientY, pane: s.mobilePane };
    s.setMobileDrawerDragX(0);
  }

  function handleDrawerGestureMove(e: ReactTouchEvent<HTMLDivElement>) {
    const start = s.mobileDrawerGestureRef.current;
    const touch = e.touches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (start.pane === "right") {
      if (deltaX <= 0) return;
      if (Math.abs(deltaY) > Math.abs(deltaX) * 1.35) return;
      if (Math.abs(deltaX) < 16) return;
    } else if (Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }
    e.preventDefault();
    s.setMobileDrawerDragX(deltaX);
  }

  function handleDrawerGestureEnd(e: ReactTouchEvent<HTMLDivElement>) {
    const start = s.mobileDrawerGestureRef.current;
    s.mobileDrawerGestureRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    if (!touch) { s.setMobileDrawerDragX(0); return; }
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    s.setMobileDrawerDragX(0);
    if (Math.abs(deltaY) > Math.abs(deltaX) && start.pane !== "right") return;
    if (Math.abs(deltaX) < (start.pane === "right" ? 34 : 54)) return;
    if (start.pane === "middle") {
      if (deltaX > 0) openMobilePane("left");
      else if (deltaX < 0 && s.rightDrawerEnabled) openMobilePane("right");
      return;
    }
    if (start.pane === "left" && deltaX < 0) { openMobilePane("middle"); return; }
    if (start.pane === "right") openMobilePane("middle");
  }

  // -- Mail-row swipe helpers --

  function clearMailSwipeFeedback(id: string) {
    const timeoutId = s.swipeFeedbackTimeoutsRef.current[id];
    if (typeof timeoutId === "number") {
      window.clearTimeout(timeoutId);
      delete s.swipeFeedbackTimeoutsRef.current[id];
    }
    s.setMailSwipeFeedback((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function showMailSwipeFeedback(id: string, action: MobileSwipeAction) {
    clearMailSwipeFeedback(id);
    s.setMailSwipeFeedback((prev) => ({ ...prev, [id]: action }));
    s.swipeFeedbackTimeoutsRef.current[id] = window.setTimeout(() => {
      s.setMailSwipeFeedback((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete s.swipeFeedbackTimeoutsRef.current[id];
    }, 1200);
  }

  function upsertEmailAtIndex(nextList: typeof s.emails, email: (typeof s.emails)[number], index: number) {
    const without = nextList.filter((entry) => entry.id !== email.id);
    const safeIndex = clamp(index, 0, without.length);
    without.splice(safeIndex, 0, email);
    return without;
  }

  function removePendingSwipeTrashUndo(emailId: string) {
    s.setPendingSwipeTrashUndos((prev) => prev.filter((entry) => entry.email.id !== emailId));
  }

  function restoreSwipeTrashedEmail(entry: (typeof s.pendingSwipeTrashUndos)[number]) {
    removePendingSwipeTrashUndo(entry.email.id);
    const allMode = s.selectedAccountIdRef.current === "__all__";
    if (
      !allMode &&
      (s.selectedAccountIdRef.current !== entry.sourceAccountId ||
       s.selectedFolderPathRef.current !== entry.sourceFolderPath)
    ) return;
    s.setEmails((prev) => upsertEmailAtIndex(prev, entry.email, entry.originalIndex));
  }

  function scheduleSwipeTrashWithUndo(email: (typeof s.emails)[number]) {
    const originalIndex = s.emails.findIndex((entry) => entry.id === email.id);
    if (originalIndex < 0) return false;
    s.setUiError("");
    s.setUiInfo("");
    s.setEmails((prev) => prev.filter((entry) => entry.id !== email.id));
    if (s.selectedEmail?.id === email.id) {
      s.setSelectedEmail(null);
      openMobilePane("middle");
      s.setEmailDetailMenuOpen(false);
    }
    s.setPendingSwipeTrashUndos((prev) => {
      const existing = prev.find((entry) => entry.email.id === email.id);
      if (existing) window.clearTimeout(existing.timeoutId);
      return prev.filter((entry) => entry.email.id !== email.id);
    });
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const res = await fetch(`/api/emails/${email.id}/move`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetSpecial: "trash" }),
        });
        if (!res.ok) {
          try {
            const data = (await res.json()) as { error?: string };
            s.setUiError(data.error ?? "Swipe-Löschen fehlgeschlagen.");
          } catch {
            s.setUiError("Swipe-Löschen fehlgeschlagen.");
          }
          const restoreEntry =
            s.pendingSwipeTrashUndosRef.current.find((item) => item.email.id === email.id) ?? null;
          removePendingSwipeTrashUndo(email.id);
          if (
            restoreEntry &&
            (s.selectedAccountIdRef.current === "__all__" ||
             (s.selectedAccountIdRef.current === restoreEntry.sourceAccountId &&
              s.selectedFolderPathRef.current === restoreEntry.sourceFolderPath))
          ) {
            s.setEmails((current) =>
              upsertEmailAtIndex(current, restoreEntry.email, restoreEntry.originalIndex),
            );
          }
          return;
        }
        removePendingSwipeTrashUndo(email.id);
        await sync.reloadFolders();
      })();
    }, 5000);
    s.swipeTrashUndoSeqRef.current += 1;
    s.setPendingSwipeTrashUndos((prev) => [
      ...prev,
      {
        id: `swipe-trash-${email.id}-${s.swipeTrashUndoSeqRef.current}`,
        email,
        originalIndex,
        sourceAccountId: s.selectedAccountId,
        sourceFolderPath: s.selectedFolderPath,
        timeoutId,
      },
    ]);
    return true;
  }

  async function executeSwipeAction(email: (typeof s.emails)[number], action: MobileSwipeAction) {
    if (action === "none") return false;
    if (action === "trash") return scheduleSwipeTrashWithUndo(email);
    if (action === "mark_read") { await actions.runActionForEmail(email.id, `/api/emails/${email.id}/mark-read`); return true; }
    if (action === "mark_unread") { await actions.runActionForEmail(email.id, `/api/emails/${email.id}/mark-unread`); return true; }
    if (action === "print") { window.open(`/api/emails/${email.id}/print?mode=${s.printMode}`, "_blank"); s.setUiInfo("Druckansicht geöffnet."); return true; }
    return false;
  }

  function handleMailRowSwipeStart(emailId: string, e: ReactTouchEvent<HTMLDivElement>) {
    const touch = e.touches[0];
    if (!touch) return;
    s.mailRowSwipeStartRef.current = { id: emailId, x: touch.clientX, y: touch.clientY };
    s.setMailSwipeOffsets((prev) => (prev[emailId] ? { ...prev, [emailId]: 0 } : prev));
  }

  function handleMailRowSwipeMove(emailId: string, e: ReactTouchEvent<HTMLDivElement>) {
    const state = s.mailRowSwipeStartRef.current;
    const touch = e.touches[0];
    if (!state || state.id !== emailId || !touch) return;
    const deltaX = touch.clientX - state.x;
    const deltaY = touch.clientY - state.y;
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    e.preventDefault();
    s.setMailSwipeOffsets((prev) => ({ ...prev, [emailId]: clamp(deltaX, -112, 112) }));
  }

  async function handleMailRowSwipeEnd(email: (typeof s.emails)[number], e: ReactTouchEvent<HTMLDivElement>) {
    const state = s.mailRowSwipeStartRef.current;
    s.mailRowSwipeStartRef.current = null;
    const touch = e.changedTouches[0];
    const deltaX = touch ? touch.clientX - (state?.x ?? touch.clientX) : 0;
    s.setMailSwipeOffsets((prev) => {
      if (!prev[email.id]) return prev;
      const next = { ...prev };
      delete next[email.id];
      return next;
    });
    if (!state || state.id !== email.id || Math.abs(deltaX) < 70) return;
    const direction = deltaX < 0 ? "left" : "right";
    const action = getSwipeActionForDirection(direction);
    const executed = await executeSwipeAction(email, action);
    if (executed) showMailSwipeFeedback(email.id, action);
  }

  function getSwipeActionForDirection(direction: "left" | "right"): MobileSwipeAction {
    return direction === "left" ? s.leftSwipeAction : s.rightSwipeAction;
  }

  function getMobileSwipeActionLabel(action: MobileSwipeAction) {
    const map: Record<MobileSwipeAction, string> = {
      none: "Keine Aktion", trash: "Papierkorb", mark_read: "Als gelesen",
      mark_unread: "Als ungelesen", print: "Drucken",
    };
    return map[action];
  }

  // -- Folder drag-and-drop --

  function handleFolderDragOver(e: React.DragEvent, path: string) {
    e.preventDefault();
    if (s.dragOverFolderPath !== path) {
      if (s.dragExpandTimeoutRef.current) clearTimeout(s.dragExpandTimeoutRef.current);
      s.setDragOverFolderPath(path);
      s.dragExpandTimeoutRef.current = setTimeout(() => {
        s.setExpandedFolderPaths((prev) => {
          if (prev.has(path)) return prev;
          const next = new Set(prev);
          next.add(path);
          return next;
        });
      }, 800);
    }
  }

  function handleFolderDragLeave() {
    if (s.dragExpandTimeoutRef.current) { clearTimeout(s.dragExpandTimeoutRef.current); s.dragExpandTimeoutRef.current = null; }
    s.setDragOverFolderPath(null);
  }

  function handleFolderDrop(e: React.DragEvent, targetPath: string) {
    e.preventDefault();
    if (s.dragExpandTimeoutRef.current) { clearTimeout(s.dragExpandTimeoutRef.current); s.dragExpandTimeoutRef.current = null; }
    s.setDragOverFolderPath(null);
    const idsRaw = e.dataTransfer.getData("text/x-mailpilot-email-ids");
    const emailId = e.dataTransfer.getData("text/x-mailpilot-email-id");
    let ids: string[] = [];
    try { ids = idsRaw ? (JSON.parse(idsRaw) as string[]) : []; } catch { /* ignore */ }
    if (ids.length === 0 && emailId) ids = [emailId];
    if (ids.length === 0) return;

    if (ids.length > 1) {
      void actions.runBulk("move_folder", { targetFolder: targetPath }, ids);
    } else {
      const singleId = ids[0];
      const droppedEmail = s.emails.find((em) => em.id === singleId);
      void actions.runActionForEmail(singleId, `/api/emails/${singleId}/move`, { targetFolder: targetPath });
      if (droppedEmail?.fromEmail) {
        void actions.checkSenderProfileAfterMove(droppedEmail.fromEmail, droppedEmail.fromName ?? "", targetPath, singleId);
      }
    }
  }

  // -- Selection --

  function clearSelection() { s.setSelectedIds(new Set()); }

  function toggleSelected(id: string, shiftKey?: boolean) {
    const isShift = shiftKey ?? s.shiftHeldRef.current;
    if (isShift && s.lastSelectedIdRef.current && s.lastSelectedIdRef.current !== id) {
      const lastIdx = s.emails.findIndex((e) => e.id === s.lastSelectedIdRef.current);
      const curIdx = s.emails.findIndex((e) => e.id === id);
      if (lastIdx !== -1 && curIdx !== -1) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        s.setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(s.emails[i].id);
          return next;
        });
        s.lastSelectedIdRef.current = id;
        return;
      }
    }
    s.setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    s.lastSelectedIdRef.current = id;
  }

  function toggleSelectAllVisible() {
    if (s.emails.length === 0) return;
    const allSelected = s.emails.every((e) => s.selectedIds.has(e.id));
    if (allSelected) s.setSelectedIds(new Set());
    else s.setSelectedIds(new Set(s.emails.map((e) => e.id)));
  }

  // -- Context menu --

  function closeMailContextMenu() { s.setMailContextMenu(null); }

  function openMailContextMenu(e: ReactMouseEvent, email: (typeof s.emails)[number]) {
    e.preventDefault();
    e.stopPropagation();
    const useCurrentSelection = s.selectedIds.size > 1 && s.selectedIds.has(email.id);
    const targetIds = useCurrentSelection ? Array.from(s.selectedIds) : [email.id];
    if (!useCurrentSelection) s.setSelectedIds(new Set([email.id]));
    s.setMailContextMenu({ x: e.clientX, y: e.clientY, emailId: email.id, targetIds });
    s.setContextMoveTargetFolder(s.moveTargetFolder || s.folders[0]?.path || "");
    s.setContextAttachmentId(email.attachments?.[0]?.id ?? "");
  }

  // -- Folder selection --

  function onFolderSelect(path: string) {
    s.setSelectedLabel(null);
    s.setSelectedFolderPath(path);
    s.setSelectedEmail(null);
    s.setBodyContent(null);
    s.setMobilePane("middle");
    s.setEmailDetailMenuOpen(false);
  }

  // -- Persist layout --

  function setMobileMainHeaderExpandedPersist(next: boolean) {
    s.setMobileMainHeaderExpanded(next);
    try { window.localStorage.setItem(MOBILE_MAIN_HEADER_LS_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  }

  function dragFolder(dx: number) {
    s.setFolderWidth((prev) => {
      const next = clamp(prev + dx, FOLDER_WIDTH_MIN, FOLDER_WIDTH_MAX);
      try { window.localStorage.setItem(FOLDER_LS_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function dragList(dx: number) {
    s.setListWidth((prev) => {
      const next = clamp(prev + dx, LIST_WIDTH_MIN, LIST_WIDTH_MAX);
      try { window.localStorage.setItem(LIST_LS_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // -- Deep link --

  async function applyDeepLinkParams() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const emailId = url.searchParams.get("emailId");
    const acc = url.searchParams.get("accountId");
    const fld = url.searchParams.get("folder");
    if (!emailId && !acc && !fld) return;
    if (acc) s.setSelectedAccountId(acc);
    if (fld) s.setSelectedFolderPath(fld);
    if (emailId) await sync.loadEmail(emailId);
    url.searchParams.delete("emailId");
    url.searchParams.delete("accountId");
    url.searchParams.delete("folder");
    window.history.replaceState({}, "", url.toString());
  }

  function loadPersistedWidths() {
    if (typeof window === "undefined") return;
    try {
      const f = window.localStorage.getItem(FOLDER_LS_KEY);
      const l = window.localStorage.getItem(LIST_LS_KEY);
      const fw = f ? parseInt(f, 10) : NaN;
      const lw = l ? parseInt(l, 10) : NaN;
      if (Number.isFinite(fw)) s.setFolderWidth(clamp(fw, FOLDER_WIDTH_MIN, FOLDER_WIDTH_MAX));
      if (Number.isFinite(lw)) s.setListWidth(clamp(lw, LIST_WIDTH_MIN, LIST_WIDTH_MAX));
    } catch { /* ignore */ }
  }

  // =========================================================================
  // useEffect orchestration
  // =========================================================================

  useEffect(() => { s.loadMoreEmailsRef.current = sync.loadMoreEmails; });
  useEffect(() => { s.pendingSwipeTrashUndosRef.current = s.pendingSwipeTrashUndos; }, [s.pendingSwipeTrashUndos]);
  useEffect(() => { s.selectedAccountIdRef.current = s.selectedAccountId; }, [s.selectedAccountId]);
  useEffect(() => { s.selectedFolderPathRef.current = s.selectedFolderPath; }, [s.selectedFolderPath]);

  // Init: load accounts, candidates, signatures, settings, labels, send-due
  useEffect(() => {
    const timer = setTimeout(() => {
      void sync.loadAccounts();
      void sync.loadContactCandidates();
      void sync.loadSignatureSettings();
      void sync.loadAutomationSettings();
      void sync.loadLabels();
      void fetch("/api/compose/send-due", { method: "POST" });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Automation dashboard: load settings + runs when opened
  useEffect(() => {
    if (!s.automationDashboardOpen) return;
    let cancelled = false;
    s.setAutomationLoading(true);
    void (async () => {
      try { await Promise.all([sync.loadAutomationSettings(), sync.loadAutomationRuns()]); }
      finally { if (!cancelled) s.setAutomationLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [s.automationDashboardOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automation dashboard: auto-refresh runs
  useEffect(() => {
    if (!s.automationDashboardOpen) return;
    if (typeof window === "undefined") return;
    if (s.automationRefreshRef.current !== null) { window.clearInterval(s.automationRefreshRef.current); s.automationRefreshRef.current = null; }
    s.automationRefreshRef.current = window.setInterval(() => { void sync.loadAutomationRuns(); }, 15000);
    return () => { if (s.automationRefreshRef.current !== null) { window.clearInterval(s.automationRefreshRef.current); s.automationRefreshRef.current = null; } };
  }, [s.automationDashboardOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Link-click from iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "mailpilot-link-click" && typeof e.data.href === "string") {
        const href: string = e.data.href;
        if (/^mailto:/i.test(href)) { window.location.href = href; return; }
        if (/^https?:\/\//i.test(href)) s.setPendingLinkUrl(href);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Maximized body: Escape + overflow lock + menu reset
  useEffect(() => {
    if (!s.isBodyMaximized) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") s.setIsBodyMaximized(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.isBodyMaximized]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!s.isBodyMaximized) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [s.isBodyMaximized]);
  useEffect(() => {
    if (!s.isBodyMaximized) s.setMaximizedBodyMenuOpen(false);
  }, [s.isBodyMaximized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prevent mobile page scroll
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevBodyHeight = body.style.height;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.height = "100%";
    body.style.height = "100%";
    return () => { html.style.overflow = prevHtmlOverflow; body.style.overflow = prevBodyOverflow; html.style.height = prevHtmlHeight; body.style.height = prevBodyHeight; };
  }, []);

  // Load folders when account changes
  useEffect(() => {
    if (!s.selectedAccountId || s.isAllAccounts) {
      if (s.isAllAccounts) {
        const timer = setTimeout(() => { s.setFolders([]); s.setSelectedFolderPath(""); s.setMoveTargetFolder(""); }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }
    const timer = setTimeout(() => { void sync.loadFolders(s.selectedAccountId); }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selectedAccountId]);

  // Load emails when filters change
  useEffect(() => {
    if (s.selectedLabel) return;
    const timer = setTimeout(() => { void sync.loadEmails(); }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selectedAccountId, s.selectedFolderPath, s.query, s.hasAttachmentsFilter, s.actionRequiredFilter, s.localFlagFilter, s.tab, s.sort, s.mailScrollBatchSize, s.selectedLabel]);

  // Invalidate in-flight detail when context changes
  useEffect(() => {
    s.activeLoadEmailRequestIdRef.current += 1;
  }, [s.selectedAccountId, s.selectedFolderPath, s.query, s.tab, s.sort, s.hasAttachmentsFilter, s.actionRequiredFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shift-key tracking
  useEffect(() => {
    const down = (e: KeyboardEvent) => { s.shiftHeldRef.current = e.shiftKey; };
    const up = (e: KeyboardEvent) => { s.shiftHeldRef.current = e.shiftKey; };
    const blur = () => { s.shiftHeldRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll sentinel
  useEffect(() => {
    const root = s.listScrollRef.current;
    const target = s.loadMoreSentinelRef.current;
    if (!root || !target || !s.emailsHasMore) return;
    const obs = new IntersectionObserver(
      (entries) => { if (!entries[0]?.isIntersecting) return; void s.loadMoreEmailsRef.current(); },
      { root, rootMargin: "200px", threshold: 0 },
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [s.emailsHasMore, s.emails.length, s.selectedAccountId, s.selectedFolderPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset selection on context pivot
  useEffect(() => {
    s.setSelectedIds(new Set());
  }, [s.selectedAccountId, s.selectedFolderPath, s.tab, s.query, s.hasAttachmentsFilter, s.actionRequiredFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile pane guard
  useEffect(() => {
    if (!s.rightDrawerEnabled && s.mobilePane === "right") s.setMobilePane("middle");
    if (!s.selectedEmail) s.setMobileMovePanelOpen(false);
    if (s.mobilePane !== "right") s.setMobileMovePanelOpen(false);
  }, [s.selectedEmail, s.mobilePane, s.rightDrawerEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup swipe timeouts
  useEffect(() => {
    const feedbackTimeouts = s.swipeFeedbackTimeoutsRef.current;
    const pendingUndos = s.pendingSwipeTrashUndosRef.current;
    return () => {
      for (const timeoutId of Object.values(feedbackTimeouts)) { if (typeof timeoutId === "number") window.clearTimeout(timeoutId); }
      for (const pending of pendingUndos) window.clearTimeout(pending.timeoutId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup intervals
  useEffect(() => {
    return () => {
      if (s.syncAllProgressPollRef.current !== null) { window.clearInterval(s.syncAllProgressPollRef.current); s.syncAllProgressPollRef.current = null; }
      if (s.automationRefreshRef.current !== null) { window.clearInterval(s.automationRefreshRef.current); s.automationRefreshRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync menu close
  useEffect(() => {
    if (!s.showSyncMenu) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") s.setShowSyncMenu(false); }
    function onClickAway(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-sync-menu-root]")) return;
      s.setShowSyncMenu(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClickAway);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("click", onClickAway); };
  }, [s.showSyncMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  // Email detail menu close
  useEffect(() => {
    if (!s.emailDetailMenuOpen) return;
    let cancelled = false;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") s.setEmailDetailMenuOpen(false); }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-email-detail-menu-root]")) return;
      s.setEmailDetailMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => { if (!cancelled) window.addEventListener("pointerdown", onPointerDown, true); }, 0);
    return () => { cancelled = true; window.clearTimeout(t); window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPointerDown, true); };
  }, [s.emailDetailMenuOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Maximized body menu close
  useEffect(() => {
    if (!s.maximizedBodyMenuOpen) return;
    let cancelled = false;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") s.setMaximizedBodyMenuOpen(false); }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-max-body-menu-root]")) return;
      s.setMaximizedBodyMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => { if (!cancelled) window.addEventListener("pointerdown", onPointerDown, true); }, 0);
    return () => { cancelled = true; window.clearTimeout(t); window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPointerDown, true); };
  }, [s.maximizedBodyMenuOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Iframe height measurement
  useLayoutEffect(() => {
    if (s.bodyMode !== "html" || !safeMailDocument) return;
    const frame = s.mailBodyIframeRef.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const measureAndApplyHeight = () => {
      const el = s.mailBodyIframeRef.current;
      if (!el) return;
      try {
        const doc = el.contentDocument;
        const b = doc?.body;
        const htmlEl = doc?.documentElement;
        if (!b || !htmlEl) return;
        const h = Math.max(b.scrollHeight, htmlEl.scrollHeight, b.offsetHeight, htmlEl.offsetHeight);
        el.style.minHeight = `${Math.max(h + 64, 480)}px`;
      } catch { /* ignore */ }
    };
    const onLoad = () => {
      measureAndApplyHeight();
      requestAnimationFrame(measureAndApplyHeight);
      window.setTimeout(measureAndApplyHeight, 200);
      window.setTimeout(measureAndApplyHeight, 1200);
      const doc = frame.contentDocument;
      const b = doc?.body;
      if (b && typeof ResizeObserver !== "undefined") {
        ro?.disconnect();
        ro = new ResizeObserver(() => measureAndApplyHeight());
        ro.observe(b);
      }
    };
    frame.addEventListener("load", onLoad);
    onLoad();
    return () => { frame.removeEventListener("load", onLoad); ro?.disconnect(); frame.style.height = ""; };
  }, [safeMailDocument, s.bodyMode, s.selectedEmail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast-Sync: auto-timer for inbox only
  useEffect(() => {
    if (!s.selectedAccountId || s.isAllAccounts) return;
    const intervalMs = Math.max(1, s.newMailCheckIntervalMinutes) * 60 * 1000;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (s.isSyncing || s.autoCheckInFlightRef.current) return;
      s.autoCheckInFlightRef.current = true;
      void (async () => { try { await sync.syncInboxOnly(); } finally { s.autoCheckInFlightRef.current = false; } })();
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selectedAccountId, s.newMailCheckIntervalMinutes, s.isSyncing]);

  // Idle-based full sync tracking
  useEffect(() => {
    function markActive() { s.lastUserActionRef.current = Date.now(); s.idleFullSyncDoneRef.current = false; }
    window.addEventListener("click", markActive);
    window.addEventListener("keydown", markActive);
    window.addEventListener("scroll", markActive, true);
    return () => { window.removeEventListener("click", markActive); window.removeEventListener("keydown", markActive); window.removeEventListener("scroll", markActive, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Idle full-sync timer
  useEffect(() => {
    if (!s.selectedAccountId || s.isAllAccounts) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (s.isSyncing || s.autoCheckInFlightRef.current) return;
      if (s.idleFullSyncDoneRef.current) return;
      const idleMs = Date.now() - s.lastUserActionRef.current;
      if (idleMs >= IDLE_FULL_SYNC_MS) {
        s.idleFullSyncDoneRef.current = true;
        s.autoCheckInFlightRef.current = true;
        void (async () => { try { await sync.syncAllFolders("auto"); } finally { s.autoCheckInFlightRef.current = false; } })();
      }
    }, 2 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selectedAccountId, s.isSyncing]);

  // Folder refresh interval + visibility
  useEffect(() => {
    if (!s.selectedAccountId || s.isAllAccounts) return;
    if (typeof document === "undefined") return;
    const triggerRefresh = () => { if (document.visibilityState !== "visible") return; void sync.loadFolders(s.selectedAccountId); };
    const timer = window.setInterval(() => { triggerRefresh(); }, FOLDER_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => { triggerRefresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibilityChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.selectedAccountId]);

  // Compose editor init
  useEffect(() => {
    if (!s.composeOpen) { s.composeInitializedRef.current = false; return; }
    if (s.composeInitializedRef.current || !s.composeEditorRef.current) return;
    s.composeInitializedRef.current = true;
    s.composeEditorRef.current.innerHTML = s.composeForm.bodyHtml || "";
    requestAnimationFrame(() => {
      const editor = s.composeEditorRef.current;
      if (!editor) return;
      const firstDiv = editor.querySelector("div[dir='ltr']") || editor.firstChild;
      if (firstDiv) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(firstDiv, 0);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      editor.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.composeOpen]);

  // Context menu dismiss
  useEffect(() => {
    if (!s.mailContextMenu) return;
    function close() { s.setMailContextMenu(null); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", onKey); };
  }, [s.mailContextMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore persisted widths
  useEffect(() => { const t = setTimeout(() => { loadPersistedWidths(); }, 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore persisted mobile settings
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(MOBILE_MAIN_HEADER_LS_KEY);
      if (v === "0") s.setMobileMainHeaderExpanded(false);
      if (v === "1") s.setMobileMainHeaderExpanded(true);
      const folderCountMode = window.localStorage.getItem(FOLDER_COUNT_MODE_LS_KEY);
      if (folderCountMode === "compact" || folderCountMode === "uga") s.setFolderCountDisplayMode(folderCountMode);
      const persistedLeft = window.localStorage.getItem(MOBILE_SWIPE_LEFT_ACTION_LS_KEY);
      const persistedRight = window.localStorage.getItem(MOBILE_SWIPE_RIGHT_ACTION_LS_KEY);
      const isSwipeAction = (value: string | null): value is MobileSwipeAction =>
        value === "none" || value === "trash" || value === "mark_read" || value === "mark_unread" || value === "print";
      if (isSwipeAction(persistedLeft)) s.setLeftSwipeAction(persistedLeft);
      if (isSwipeAction(persistedRight)) s.setRightSwipeAction(persistedRight);
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link
  useEffect(() => { const t = setTimeout(() => { void applyDeepLinkParams(); }, 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // JSX
  // =========================================================================

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Collapsed mobile header */}
      <div className={`glass-solid z-20 shrink-0 items-center justify-between gap-2 border-b-0 px-2 py-1.5 lg:hidden ${s.mobileMainHeaderExpanded ? "hidden" : "flex"}`}>
        <span className="min-w-0 truncate text-xs font-semibold glass-text-primary">MailPilot{s.selectedAccount ? <span className="font-normal glass-text-secondary"> · {s.selectedAccount.name}</span> : null}</span>
        <button type="button" onClick={() => setMobileMainHeaderExpandedPersist(true)} className="glass-btn shrink-0 rounded-lg p-2" aria-label="Hauptmenü anzeigen" title="Hauptmenü anzeigen">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </div>

      {/* Main header */}
      <header className={`glass-solid sticky top-0 z-20 shrink-0 flex-wrap items-center gap-2 border-b-0 px-3 py-2 md:px-4 lg:flex ${s.mobileMainHeaderExpanded ? "flex" : "hidden"}`}>
        <div className="flex w-full shrink-0 items-center gap-2 lg:contents">
          <button onClick={() => s.setFoldersOpen((v) => !v)} aria-label={s.foldersOpen ? "Ordner einklappen" : "Ordner ausklappen"} title={s.foldersOpen ? "Ordner einklappen" : "Ordner ausklappen"} className="glass-btn rounded-lg px-2 py-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1 className="min-w-0 shrink truncate text-base font-semibold glass-text-primary lg:shrink-0 lg:overflow-visible lg:whitespace-normal">MailPilot</h1>
          <button type="button" onClick={() => setMobileMainHeaderExpandedPersist(false)} className="glass-btn ml-auto shrink-0 rounded-lg p-2 lg:hidden" aria-label="Hauptmenü einklappen" title="Mehr Platz für Mails">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><polyline points="18 15 12 9 6 15" /></svg>
          </button>
        </div>
        <button onClick={actions.composeNewMail} title="Neue E-Mail" className="glass-btn-primary rounded-lg px-3 py-1.5 text-sm">Neue Mail</button>
        <select value={s.selectedAccountId} onChange={(e) => { s.setSelectedAccountId(e.target.value); s.setSelectedFolderPath(""); s.setFolders([]); s.setMoveTargetFolder(""); s.setEmails([]); s.setSelectedEmail(null); s.setBodyContent(null); s.setMobilePane("middle"); s.setEmailDetailMenuOpen(false); }} className="glass-select ml-2 rounded-lg px-2 py-1.5 text-sm">
          <option value="">Konto wählen</option>
          {s.accounts.length > 1 && <option value="__all__">Alle Konten</option>}
          {s.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <div className="relative ml-auto flex-1 md:max-w-md">
          <input value={s.query} onChange={(e) => s.setQuery(e.target.value)} placeholder="Suchen in Betreff, Absender, Inhalt..." className="glass-input w-full rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div className="relative" data-sync-menu-root>
          <button type="button" onClick={() => s.setShowSyncMenu((v) => !v)} disabled={s.isSyncing || !s.selectedAccountId || s.isAllAccounts} aria-haspopup="menu" aria-expanded={s.showSyncMenu} className="glass-btn-dark rounded-lg px-3 py-1.5 text-sm disabled:opacity-60" title={s.isAllAccounts ? "Sync nicht verfügbar im Alle-Konten-Modus" : "Synchronisationsoptionen"}>
            {s.isSyncing ? "Synchronisiere..." : "Synchronisieren ▾"}
          </button>
          {s.showSyncMenu ? (
            <div id="mailpilot-sync-menu" role="menu" className="glass-solid absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-xl">
              <button role="menuitem" onClick={() => { s.setShowSyncMenu(false); void sync.syncAllFolders("manual"); }} disabled={s.isSyncing || !s.selectedAccountId || s.isAllAccounts} className="block w-full border-b glass-divider px-3 py-2 text-left text-sm hover:bg-white/30 disabled:opacity-50">
                <span className="font-medium glass-text-primary">Delta-Sync (alle Ordner)</span>
                <span className="block text-xs glass-text-tertiary">Standardlauf: Delta-Sync kontoweit über alle Verzeichnisse, inkl. Fortschritt + ETA</span>
              </button>
              <div className="px-3 py-2 text-xs glass-text-tertiary">Auto-Update nutzt denselben Delta-Sync im Intervall. Vollabgleich startet nie automatisch.</div>
            </div>
          ) : null}
        </div>
        <button type="button" onClick={() => void sync.checkNow()} disabled={s.isSyncing || !s.selectedAccountId || s.isAllAccounts} className="glass-btn rounded-lg px-3 py-1.5 text-sm disabled:opacity-50" title={s.isAllAccounts ? "Sync nicht verfügbar im Alle-Konten-Modus" : "Nur Inbox schnell prüfen (Fast-Sync)"}>Check jetzt</button>
        <button type="button" onClick={() => s.setAutomationDashboardOpen((v) => !v)} className="glass-btn rounded-lg px-3 py-1.5 text-sm" aria-expanded={s.automationDashboardOpen} title="Auto-Update Dashboard">Auto-Update</button>
        <a href="/search" title="Erweiterte Suche" className="glass-btn rounded-lg px-3 py-1.5 text-sm"><span className="hidden md:inline">Erweiterte Suche</span><span className="md:hidden">Suche</span></a>
        <a href="/duplicates" title="Duplikate erkennen" className="glass-btn rounded-lg px-3 py-1.5 text-sm"><span className="hidden md:inline">Duplikate</span><span className="md:hidden">Dupl.</span></a>
        <a href="/sender-profiles" title="Absender-Profile" className="glass-btn rounded-lg px-3 py-1.5 text-sm"><span className="hidden md:inline">Absender</span><span className="md:hidden">Abs.</span></a>
        <a href="/labels" title="Labels verwalten" className="glass-btn rounded-lg px-3 py-1.5 text-sm">Labels</a>
        <a href="/ai-assistant" title="KI-Assistent" className="glass-btn rounded-lg px-3 py-1.5 text-sm">✨ KI</a>
        <a href="/settings" aria-label="Einstellungen" title="Einstellungen" className="glass-btn rounded-lg px-2 py-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </a>
        <ThemeToggle className="glass-btn rounded-lg px-2 py-1.5" />
        <button onClick={actions.logout} className="glass-btn rounded-lg px-3 py-1.5 text-sm">Logout</button>
      </header>

      {/* Sync progress bar */}
      {s.syncProgress ? (
        <div className="glass-info px-4 py-1.5" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="text-xs">{s.syncProgress.label}</span>
            {s.syncProgress.kind === "all_folders" ? (
              <span className="text-xs glass-text-tertiary">
                Gesamt: {typeof s.syncProgress.totalMails === "number" ? s.syncProgress.totalMails : "…"} · Verbleibend: {typeof s.syncProgress.remainingMails === "number" ? s.syncProgress.remainingMails : "…"}{s.syncProgress.isEstimate ? " (Schätzung)" : ""}{typeof s.syncProgress.etaSeconds === "number" ? ` · ETA ~ ${Math.max(1, Math.round(s.syncProgress.etaSeconds / 60))} min` : " · ETA: …"}
              </span>
            ) : null}
          </div>
          {s.syncProgress.kind === "all_folders" ? (
            <p className="mt-1 truncate text-[11px] glass-text-tertiary" title={s.syncProgress.lastFolderPath ?? undefined}>Ordner: {s.syncProgress.lastFolderPath ? folderDisplayName(s.syncProgress.lastFolderPath) : "wird ermittelt …"}</p>
          ) : null}
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-blue-200/40" role="progressbar" aria-label={s.syncProgress.label} aria-valuetext={s.syncProgress.kind === "all_folders" && typeof s.syncProgress.remainingMails === "number" ? `${s.syncProgress.remainingMails} verbleibend` : "läuft"}>
            {s.syncProgress.kind === "all_folders" && typeof s.syncProgress.totalMails === "number" && s.syncProgress.totalMails > 0 && typeof s.syncProgress.processedMails === "number" ? (
              <div className="h-full rounded-full bg-blue-500 transition-[width] duration-700 ease-out" style={{ width: `${Math.max(2, Math.min(100, (s.syncProgress.processedMails / s.syncProgress.totalMails) * 100))}%` }} />
            ) : (
              <div className="mailpilot-progress-bar h-full w-1/3 rounded-full bg-blue-500" />
            )}
          </div>
        </div>
      ) : null}

      {/* Toast messages */}
      {s.uiError ? <p className="glass-error px-4 py-2 text-sm text-red-600">{s.uiError}</p> : null}
      {s.uiInfo ? <p className="glass-info px-4 py-2 text-sm">{s.uiInfo}</p> : null}
      {s.senderProfileToast ? (
        <div className="glass-info flex flex-wrap items-center gap-2 px-4 py-2 text-sm" role="status" aria-live="polite">
          <span className="glass-text-secondary">E-Mail von <strong className="glass-text-primary">{s.senderProfileToast.fromEmail}</strong> nach <strong className="glass-text-primary">{s.senderProfileToast.targetFolder}</strong> verschoben.</span>
          <button type="button" onClick={() => void actions.handleRememberSenderProfile()} className="glass-btn rounded-lg px-3 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-medium">Regel merken</button>
          <button type="button" onClick={() => { if (s.senderProfileToastTimerRef.current) clearTimeout(s.senderProfileToastTimerRef.current); s.setSenderProfileToast(null); }} className="glass-btn px-1.5 py-0.5 rounded text-xs glass-text-muted">✕</button>
        </div>
      ) : null}
      {s.autoMoveToast ? (
        <div className="glass-info flex flex-wrap items-center gap-2 px-4 py-2 text-sm" role="status" aria-live="polite">
          <span className="glass-text-secondary">E-Mail automatisch verschoben nach <strong className="glass-text-primary">{s.autoMoveToast.folder}</strong></span>
          <button type="button" onClick={() => { if (s.autoMoveToastTimerRef.current) clearTimeout(s.autoMoveToastTimerRef.current); s.setAutoMoveToast(null); }} className="glass-btn px-1.5 py-0.5 rounded text-xs glass-text-muted">✕</button>
        </div>
      ) : null}
      {s.pendingSwipeTrashUndos.length > 0 ? (
        <div className="glass-info flex flex-wrap items-center gap-2 px-4 py-2 text-sm" role="status" aria-live="polite">
          <span className="font-medium">{s.pendingSwipeTrashUndos.length === 1 ? "Mail wird in 5s in den Papierkorb verschoben." : `${s.pendingSwipeTrashUndos.length} Mails werden in 5s in den Papierkorb verschoben.`}</span>
          {s.pendingSwipeTrashUndos.map((entry) => (
            <button key={entry.id} type="button" onClick={() => { window.clearTimeout(entry.timeoutId); restoreSwipeTrashedEmail(entry); }} className="glass-btn rounded-lg px-2 py-1 text-xs">Rückgängig ({senderDisplayName(entry.email)})</button>
          ))}
        </div>
      ) : null}

      {/* Automation dashboard */}
      {s.automationDashboardOpen ? (
        <section id="mailpilot-automation-dashboard" className="glass-subtle border-b glass-divider px-4 py-3" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold glass-text-primary">Auto-Update Dashboard</h2>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void actions.runAutomationNow()} disabled={s.automationRunningNow || s.automationLoading || !s.selectedAccountId} className="glass-btn rounded-lg px-2.5 py-1 text-xs disabled:opacity-50">{s.automationRunningNow ? "Läuft …" : "Jetzt ausführen"}</button>
              <button type="button" onClick={() => { s.setAutomationLoading(true); void (async () => { try { await Promise.all([sync.loadAutomationSettings(), sync.loadAutomationRuns()]); } finally { s.setAutomationLoading(false); } })(); }} disabled={s.automationLoading} className="glass-btn rounded-lg px-2.5 py-1 text-xs disabled:opacity-50">Aktualisieren</button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <article className="glass rounded-xl p-3">
              <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Status</p>
              <p className="mt-1 text-sm glass-text-primary">{s.runOnAppStart ? "Automatisch beim App-Start + Intervall" : "Automatisch nur nach Intervall"}</p>
              <p className="mt-1 text-xs glass-text-tertiary">Automatik: Inbox-Sync alle {Math.max(1, Math.round(s.newMailCheckIntervalMinutes))} Minuten{typeof document !== "undefined" && document.visibilityState !== "visible" ? " (wartet bei inaktivem Tab)" : ""}</p>
              <p className="mt-1 text-xs glass-text-tertiary">Vollsync bei Inaktivität (nach 10 Min. Idle)</p>
              <p className="mt-1 text-xs glass-text-tertiary">Manuell: &quot;Check jetzt&quot; prüft nur die Inbox (Fast-Sync).</p>
              <p className="mt-1 text-xs glass-text-tertiary">Nächster Lauf: {formatDateTime(s.nextScheduledRunAt)}</p>
            </article>
            <article className="glass rounded-xl p-3">
              <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Zeitplan</p>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs glass-text-tertiary" htmlFor="automation-interval-input">Intervall</label>
                <input id="automation-interval-input" type="number" min={1} max={1440} step={1} value={s.newMailCheckIntervalMinutes} onChange={(e) => s.setNewMailCheckIntervalMinutes(Math.max(1, Number(e.target.value) || 1))} className="glass-input w-24 rounded-lg px-2 py-1 text-xs" />
                <span className="text-xs glass-text-tertiary">min</span>
                <button type="button" onClick={() => void actions.saveAutomationDashboardSettings({ runIntervalMinutes: Math.max(1, Math.round(s.newMailCheckIntervalMinutes)) })} disabled={s.automationSaving} className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50">Speichern</button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs glass-text-secondary">
                <input type="checkbox" checked={s.runOnAppStart} onChange={(e) => { const checked = e.target.checked; s.setRunOnAppStart(checked); void actions.saveAutomationDashboardSettings({ runOnAppStart: checked }); }} />
                Beim App-Start automatisch prüfen
              </label>
            </article>
            <article className="glass rounded-xl p-3">
              <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Letzter Lauf</p>
              {s.automationRuns.length > 0 ? (
                <>
                  <p className="mt-1 text-sm glass-text-primary">{formatDateTime(s.automationRuns[0]?.startedAt)} ({formatRelative(s.automationRuns[0]?.startedAt)})</p>
                  <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${formatStatusBadge(s.automationRuns[0]?.status).className}`}>{formatStatusBadge(s.automationRuns[0]?.status).label}</span>
                </>
              ) : <p className="mt-1 text-xs glass-text-tertiary">Noch keine Laufdaten vorhanden.</p>}
            </article>
          </div>
          <div className="mt-3 glass rounded-xl p-3">
            <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Letzte Läufe</p>
            {s.automationLoading ? <p className="mt-2 text-xs glass-text-tertiary">Lade Laufhistorie …</p> : s.automationRuns.length === 0 ? <p className="mt-2 text-xs glass-text-tertiary">Keine Läufe gefunden.</p> : (
              <ul className="mt-2 space-y-1">
                {s.automationRuns.map((run) => {
                  const hasError = Boolean(run.error);
                  return (
                    <li key={run.id} className={`rounded-lg border px-2 py-1 text-xs ${hasError ? "border-red-400/40 bg-red-500/10" : "border-white/30 bg-white/10"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{run.type} · {run.status}</span>
                        <span className="inline-flex items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${formatStatusBadge(run.status).className}`}>{formatStatusBadge(run.status).label}</span>
                          <span className="glass-text-tertiary">{formatDateTime(run.startedAt)}</span>
                        </span>
                      </div>
                      {hasError ? <p className="mt-1 text-red-700">{run.error}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {/* Three-pane layout */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-x-none lg:flex-row"
        onTouchStart={handleDrawerGestureStart}
        onTouchMove={handleDrawerGestureMove}
        onTouchEnd={handleDrawerGestureEnd}
        style={{ "--mp-folder-w": `${s.folderWidth}px`, "--mp-list-w": `${s.listWidth}px` } as CSSProperties}
      >
        {/* Mobile overlay */}
        <div className={`fixed inset-0 z-30 bg-black/35 transition-opacity duration-300 lg:hidden ${s.isMobileDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => openMobilePane("middle")} aria-hidden={!s.isMobileDrawerOpen} />

        {/* Folder sidebar + Email list (rendered by MailList as a single fragment) */}
        <MailList
          s={s} actions={actions} sync={sync}
          onFolderSelect={onFolderSelect}
          onFolderDragOver={handleFolderDragOver}
          onFolderDragLeave={handleFolderDragLeave}
          onFolderDrop={handleFolderDrop}
          openMobilePane={openMobilePane}
          toggleSelected={toggleSelected}
          toggleSelectAllVisible={toggleSelectAllVisible}
          openMailContextMenu={openMailContextMenu}
          handleMailRowSwipeStart={handleMailRowSwipeStart}
          handleMailRowSwipeMove={handleMailRowSwipeMove}
          handleMailRowSwipeEnd={handleMailRowSwipeEnd}
          getSwipeActionForDirection={getSwipeActionForDirection}
          getMobileSwipeActionLabel={getMobileSwipeActionLabel}
          folderResizeHandle={<ResizeHandle onDrag={dragFolder} ariaLabel="Ordnerbreite ändern" />}
        />

        <ResizeHandle onDrag={dragList} ariaLabel="Listenbreite ändern" />

        {/* Right pane: detail view */}
        <section
          className={`glass-heavy min-h-0 lg:flex-col lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:w-auto lg:flex ${s.isMobileRightPaneVisible ? "fixed inset-0 z-40 block overflow-y-auto" : "hidden lg:flex"}`}
          style={{ paddingTop: s.isMobileRightPaneVisible ? "env(safe-area-inset-top)" : undefined }}
        >
          <MailDetail s={s} actions={actions} sync={sync} openMobilePane={openMobilePane} />
        </section>
      </div>

      {/* Context menu */}
      <MailContextMenu s={s} actions={actions} sync={sync} />

      {/* Compose modal */}
      <MailCompose s={s} actions={actions} />

      {/* Empty folder modal */}
      {s.emptyFolderModalOpen && s.folderEmptyKind ? (
        <div className="glass-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !s.bulkBusy && s.setEmptyFolderModalOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="glass-modal w-full max-w-md rounded-2xl p-5">
            <h3 className="text-base font-semibold glass-text-primary">{s.folderEmptyKind === "trash" ? "Papierkorb leeren?" : "Spam leeren?"}</h3>
            <p className="mt-2 text-sm glass-text-secondary">Diese Aktion löscht alle E-Mails im Ordner <span className="font-mono">{s.selectedFolderPath}</span> <strong>endgültig</strong> und kann nicht rückgängig gemacht werden.</p>
            <p className="mt-2 text-xs glass-text-tertiary">Tippe zur Bestätigung <span className="font-mono font-semibold">LEEREN</span> ein:</p>
            <input autoFocus value={s.emptyConfirmText} onChange={(e) => s.setEmptyConfirmText(e.target.value)} placeholder="LEEREN" className="glass-input mt-2 w-full rounded-lg px-3 py-2 text-sm" />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button disabled={s.bulkBusy} onClick={() => { s.setEmptyFolderModalOpen(false); s.setEmptyConfirmText(""); }} className="glass-btn rounded-lg px-3 py-1.5 text-sm">Abbrechen</button>
              <button disabled={s.bulkBusy || s.emptyConfirmText !== "LEEREN"} onClick={() => void actions.emptyCurrentFolder()} className="rounded-lg bg-red-500/80 px-3 py-1.5 text-sm text-white backdrop-blur-sm disabled:opacity-50">{s.bulkBusy ? "Leere…" : "Endgültig leeren"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Maximized body modal */}
      {s.isBodyMaximized && s.selectedEmail && s.bodyContent ? (
        <div className="glass-overlay fixed inset-0 z-50 flex" onClick={() => s.setIsBodyMaximized(false)}>
          <div onClick={(e) => e.stopPropagation()} className="glass-modal m-auto flex h-full w-full flex-col md:h-[90vh] md:w-[90vw] md:rounded-2xl" role="dialog" aria-modal="true" aria-label="Mailinhalt vergrößert">
            <header className="flex shrink-0 items-center gap-2 border-b glass-divider px-3 py-2 md:px-4">
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold glass-text-primary md:text-lg">{s.selectedEmail.subject || "(Ohne Betreff)"}</h2>
              <div className="relative shrink-0" data-max-body-menu-root>
                <button type="button" onClick={(e) => { e.stopPropagation(); s.setMaximizedBodyMenuOpen((v) => !v); }} aria-label="Ansicht und Druck" aria-expanded={s.maximizedBodyMenuOpen} className="glass-btn flex h-10 w-10 items-center justify-center rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden><circle cx="12" cy="5" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="12" cy="19" r="1.75" /></svg>
                </button>
                {s.maximizedBodyMenuOpen ? (
                  <div role="menu" className="glass-solid absolute right-0 z-10 mt-1 w-56 rounded-xl py-2 text-sm">
                    {s.bodyContent.html && s.bodyContent.text ? (
                      <div className="border-b glass-divider px-3 py-2">
                        <p className="text-xs font-semibold glass-text-muted">Ansicht</p>
                        <div className="mt-1 flex gap-1">
                          <button type="button" onClick={() => s.setBodyMode("text")} className={`flex-1 rounded-lg px-2 py-1 text-xs ${s.bodyMode === "text" ? "glass-btn-dark" : "glass-btn"}`}>Text</button>
                          <button type="button" onClick={() => s.setBodyMode("html")} className={`flex-1 rounded-lg px-2 py-1 text-xs ${s.bodyMode === "html" ? "glass-btn-dark" : "glass-btn"}`}>HTML</button>
                        </div>
                      </div>
                    ) : null}
                    <div className="px-3 py-2">
                      <p className="text-xs font-semibold glass-text-muted">Druck</p>
                      <select value={s.printMode} onChange={(e) => s.setPrintMode(e.target.value as "html" | "text")} className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs" title="Druckmodus"><option value="html">Druck: HTML</option><option value="text">Druck: Text</option></select>
                      <button type="button" onClick={() => { s.setMaximizedBodyMenuOpen(false); actions.printSelectedEmail(); }} className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs">Drucken</button>
                    </div>
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={() => { s.setMaximizedBodyMenuOpen(false); s.setIsBodyMaximized(false); }} aria-label="Schließen" className="glass-btn shrink-0 rounded-lg px-3 py-2 text-sm">✕</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:p-4">
              {s.bodyMode === "html" && s.bodyContent.html ? (
                <div className="w-full h-full flex flex-col">
                  {!s.showExternalImages ? (
                    <div className="glass-info rounded-xl px-3 py-2 text-xs mb-2 flex items-center justify-between shrink-0">
                      <span className="glass-text-secondary">Externe Bilder blockiert.</span>
                      <button onClick={() => s.setShowExternalImages(true)} className="glass-btn rounded-lg px-3 py-1 text-xs shrink-0 ml-2">Bilder laden</button>
                    </div>
                  ) : null}
                  <iframe ref={s.mailBodyIframeRef} title="Mailinhalt vergrößert" sandbox="allow-scripts" srcDoc={safeMailDocument} referrerPolicy="no-referrer" className="block w-full flex-1 min-h-[60vh] rounded-xl glass" style={{ border: "none", maxWidth: "100%", overflow: "hidden" }} />
                </div>
              ) : (
                <div className="glass min-h-[50vh] whitespace-pre-wrap rounded-xl p-4 text-sm leading-relaxed glass-text-secondary">
                  {(() => {
                    const plain = s.bodyContent.text || s.selectedEmail.textPreview || s.selectedEmail.snippet || "";
                    return plain ? linkifyMailPlainText(plain) : "(Kein Mailinhalt verfügbar.)";
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* External link confirmation */}
      {s.pendingLinkUrl ? (
        <div className="glass-overlay fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => s.setPendingLinkUrl(null)}>
          <div className="glass-card mx-4 w-full max-w-lg rounded-2xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold glass-text-primary">Externen Link öffnen?</h3>
            <p className="mb-2 text-sm glass-text-secondary">Möchtest du diesen Link in einem neuen Tab öffnen?</p>
            <div className="mb-5 rounded-lg bg-black/5 p-3 break-all text-xs font-mono glass-text-primary">{s.pendingLinkUrl}</div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => s.setPendingLinkUrl(null)} className="glass-btn rounded-lg px-4 py-2 text-sm">Abbrechen</button>
              <button type="button" onClick={() => { window.open(s.pendingLinkUrl!, "_blank", "noopener,noreferrer"); s.setPendingLinkUrl(null); }} className="glass-btn-primary rounded-lg px-4 py-2 text-sm">Link öffnen</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Popup email modal */}
      {s.popupEmailId ? (
        <EmailDetailModal emailId={s.popupEmailId} onClose={() => s.setPopupEmailId(null)} onAction={() => { void sync.loadEmails(); }} />
      ) : null}
    </div>
  );
}
