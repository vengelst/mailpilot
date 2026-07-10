/**
 * Email list component (middle pane): renders the folder sidebar tree, the
 * list of emails with checkboxes, shift-click selection, sort/filter controls,
 * "Alle/Ungelesen/Mit Anhängen/Aktion erforderlich" filter buttons, empty-
 * folder actions, and the FolderTreeRow sub-component.
 */

import { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import {
  type Email,
  type FolderTreeNode,
  type MobileSwipeAction,
  MOBILE_SWIPE_ACTION_OPTIONS,
  LOCAL_FLAG_META,
  type LocalFlagFilter,
  clamp,
  formatDateTimeShort,
  getAccountBadgeInfo,
  getAttachmentDisplayName,
  getAvatarColor,
  getInitials,
  isUnread,
  senderDisplayName,
} from "./mail-types";
import type { MailStateReturn } from "./use-mail-state";
import type { MailActionsReturn } from "./use-mail-actions";
import type { MailSyncReturn } from "./use-mail-sync";

// ---------------------------------------------------------------------------
// FolderTreeRow
// ---------------------------------------------------------------------------

type FolderTreeRowProps = {
  node: FolderTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string;
  onSelect: (path: string) => void;
  countDisplayMode: "compact" | "uga";
  dragOverPath?: string;
  onDragOver?: (e: React.DragEvent, path: string) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, path: string) => void;
  onFolderDrop?: (sourcePath: string, targetPath: string) => void;
};

function FolderTreeRow({
  node, depth, expanded, onToggle, selectedPath, onSelect,
  countDisplayMode, dragOverPath, onDragOver, onDragLeave, onDrop, onFolderDrop,
}: FolderTreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const isActive = node.folder?.path === selectedPath;
  const isDragOver = dragOverPath === node.path && !!node.folder;
  const unread = node.folder?.unreadCount ?? 0;
  const total = node.folder?.totalCount ?? 0;
  const read = Math.max(0, total - unread);
  const selectable = !!node.folder;
  const indent = depth * 12;
  const folderCountTitle = `Ungelesen: ${unread} · Gelesen: ${read} · Alle: ${total}`;

  function handleFolderDragStart(e: React.DragEvent) {
    if (!node.folder) return;
    e.dataTransfer.setData("application/x-folder-path", node.path);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleFolderDropOnThis(e: React.DragEvent) {
    const sourceFolderPath = e.dataTransfer.getData("application/x-folder-path");
    if (sourceFolderPath && onFolderDrop && node.folder) {
      e.preventDefault();
      e.stopPropagation();
      if (sourceFolderPath !== node.path && !node.path.startsWith(sourceFolderPath + "/")) {
        onFolderDrop(sourceFolderPath, node.path);
      }
    }
  }

  return (
    <li>
      <div
        draggable={!!node.folder}
        onDragStart={handleFolderDragStart}
        className={`flex items-center gap-1 pr-2 rounded-lg mx-1 transition-colors cursor-grab active:cursor-grabbing ${
          isDragOver ? "ring-4 ring-blue-500 bg-blue-100/50 dark:bg-blue-900/30" : ""
        } ${
          isActive && !isDragOver ? "glass-active" : !isDragOver && unread > 0 ? "glass-text-primary font-medium" : !isDragOver ? "glass-text-secondary" : ""
        }`}
        style={{ paddingLeft: indent }}
        onDragOver={(e) => {
          if (node.folder && onDragOver) { e.preventDefault(); onDragOver(e, node.path); }
          if (e.dataTransfer.types.includes("application/x-folder-path")) e.preventDefault();
        }}
        onDragLeave={(e) => { if (onDragLeave) onDragLeave(e); }}
        onDrop={(e) => {
          handleFolderDropOnThis(e);
          if (node.folder && onDrop && !e.dataTransfer.types.includes("application/x-folder-path")) {
            e.preventDefault(); onDrop(e, node.path);
          }
        }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.path)}
            aria-label={isExpanded ? "Einklappen" : "Ausklappen"}
            className={`flex h-6 w-5 shrink-0 items-center justify-center text-[10px] ${
              isActive ? "text-white/70 hover:text-white" : "glass-text-muted hover:opacity-80"
            }`}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="h-6 w-5 shrink-0" />
        )}
        <button
          onClick={() => (selectable ? onSelect(node.path) : onToggle(node.path))}
          className={`flex flex-1 items-center justify-between gap-2 py-1 text-left text-sm ${
            !isActive && unread > 0 ? "font-medium" : ""
          } ${
            !isActive && selectable ? "hover:bg-white/30 rounded-lg" : ""
          } ${!isActive && !selectable ? "italic glass-text-muted hover:bg-white/20 rounded-lg" : ""}`}
          title={node.path}
        >
          <span className="flex items-center gap-1.5 truncate">
            {!isActive && unread > 0 ? (
              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
            ) : null}
            <span className="truncate">{node.segment}</span>
          </span>
          {selectable ? (
            <span className="flex shrink-0 items-center gap-1.5">
              {!isActive && unread > 0 ? (
                <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums">
                  {unread}
                </span>
              ) : null}
              <span
                className={`max-w-[7rem] truncate whitespace-nowrap text-[10px] tabular-nums sm:text-xs ${
                  isActive ? "text-white/80" : "glass-text-muted"
                }`}
                aria-label={folderCountTitle}
                title={folderCountTitle}
              >
                {total > 0
                  ? countDisplayMode === "uga"
                    ? `${isActive && unread > 0 ? `U ${unread} · ` : ""}G ${read} · A ${total}`
                    : `${isActive && unread > 0 ? `U ${unread} · ` : ""}A ${total}`
                  : ""}
              </span>
            </span>
          ) : null}
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <ul>
          {node.children.map((child) => (
            <FolderTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedPath={selectedPath}
              onSelect={onSelect}
              countDisplayMode={countDisplayMode}
              dragOverPath={dragOverPath}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onFolderDrop={onFolderDrop}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// MailList main component
// ---------------------------------------------------------------------------

type Props = {
  s: MailStateReturn;
  actions: MailActionsReturn;
  sync: MailSyncReturn;
  onFolderSelect: (path: string) => void;
  onFolderDragOver: (e: React.DragEvent, path: string) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent, targetPath: string) => void;
  openMobilePane: (pane: "left" | "middle" | "right") => void;
  toggleSelected: (id: string, shiftKey?: boolean) => void;
  toggleSelectAllVisible: () => void;
  openMailContextMenu: (e: ReactMouseEvent, email: Email) => void;
  handleMailRowSwipeStart: (emailId: string, e: ReactTouchEvent<HTMLDivElement>) => void;
  handleMailRowSwipeMove: (emailId: string, e: ReactTouchEvent<HTMLDivElement>) => void;
  handleMailRowSwipeEnd: (email: Email, e: ReactTouchEvent<HTMLDivElement>) => void;
  getSwipeActionForDirection: (direction: "left" | "right") => MobileSwipeAction;
  getMobileSwipeActionLabel: (action: MobileSwipeAction) => string;
  folderResizeHandle?: React.ReactNode;
};

export function MailList({
  s, actions, sync, onFolderSelect, onFolderDragOver, onFolderDragLeave,
  onFolderDrop, openMobilePane, toggleSelected, toggleSelectAllVisible,
  openMailContextMenu, handleMailRowSwipeStart, handleMailRowSwipeMove,
  handleMailRowSwipeEnd, getSwipeActionForDirection, getMobileSwipeActionLabel,
  folderResizeHandle,
}: Props) {
  function toggleFolderExpanded(path: string) {
    s.setExpandedFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function setFolderCountDisplayModePersist(next: "compact" | "uga") {
    s.setFolderCountDisplayMode(next);
    try { window.localStorage.setItem("mailpilot.layout.folderCountMode", next); } catch { /* ignore */ }
  }

  function setLeftSwipeActionPersist(next: MobileSwipeAction) {
    s.setLeftSwipeAction(next);
    s.setRightSwipeAction(s.rightSwipeAction);
    try {
      window.localStorage.setItem("mailpilot.mobileSwipe.leftAction", next);
      window.localStorage.setItem("mailpilot.mobileSwipe.rightAction", s.rightSwipeAction);
    } catch { /* ignore */ }
  }

  function setRightSwipeActionPersist(next: MobileSwipeAction) {
    s.setRightSwipeAction(next);
    s.setLeftSwipeAction(s.leftSwipeAction);
    try {
      window.localStorage.setItem("mailpilot.mobileSwipe.leftAction", s.leftSwipeAction);
      window.localStorage.setItem("mailpilot.mobileSwipe.rightAction", next);
    } catch { /* ignore */ }
  }

  return (
    <>
      {/* ---- Folder sidebar ---- */}
      {s.foldersOpen ? (
        <aside
          className={`glass min-w-0 shrink-0 overflow-x-hidden border-r-0 lg:static lg:z-auto lg:max-h-none lg:w-[var(--mp-folder-w)] lg:shrink-0 lg:flex lg:flex-col ${
            s.isMobileLeftPaneVisible
              ? "fixed inset-0 z-40 block overflow-y-auto"
              : "hidden lg:flex"
          }`}
          style={{ paddingTop: s.isMobileLeftPaneVisible ? "env(safe-area-inset-top)" : undefined }}
        >
          <div className="lg:shrink-0 border-b glass-divider px-3 py-2 space-y-2">
            <div className="flex items-center justify-between lg:hidden">
              <span className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Navigation</span>
              <button type="button" onClick={() => openMobilePane("middle")} className="glass-btn rounded-lg px-2 py-1 text-xs" aria-label="Navigation schließen" title="Zur Mail-Liste">Schließen</button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Ordner</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setFolderCountDisplayModePersist("compact")} className={`rounded px-1.5 py-0.5 text-[10px] ${s.folderCountDisplayMode === "compact" ? "bg-white/35 glass-text-primary" : "glass-text-muted hover:bg-white/20"}`} title="Kompakte Zähleranzeige (U + A)" aria-pressed={s.folderCountDisplayMode === "compact"}>Kompakt</button>
                <button type="button" onClick={() => setFolderCountDisplayModePersist("uga")} className={`rounded px-1.5 py-0.5 text-[10px] ${s.folderCountDisplayMode === "uga" ? "bg-white/35 glass-text-primary" : "glass-text-muted hover:bg-white/20"}`} title="Explizite Zähleranzeige (U/G/A)" aria-pressed={s.folderCountDisplayMode === "uga"}>U/G/A</button>
                <button onClick={() => void sync.reloadFolders()} className="text-xs glass-text-muted hover:opacity-80" title="Ordner aktualisieren">↻</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" onClick={actions.createFolderPrompt} disabled={s.isManagingFolder || !s.selectedAccountId} className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50" title="Neuen Ordner erstellen">+ Ordner</button>
              <button type="button" onClick={actions.renameFolderPrompt} disabled={s.isManagingFolder || !s.selectedFolderPath} className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50" title="Ausgewählten Ordner umbenennen / verschieben">Umbenennen</button>
              <button type="button" onClick={actions.copyFolderPrompt} disabled={s.isManagingFolder || !s.selectedFolderPath} className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50" title="Ausgewählten Ordner kopieren">Kopieren</button>
              <button type="button" onClick={actions.deleteFolderPrompt} disabled={s.isManagingFolder || !s.selectedFolderPath} className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50" title="Ausgewählten Ordner löschen">Löschen</button>
            </div>
            {s.selectedFolderPath ? (
              <p className="text-[11px] glass-text-muted truncate" title={s.selectedFolderPath}>
                Aktuell: {s.selectedFolderPath.split("/").pop()}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-1 border-t glass-divider pt-2 lg:hidden">
              <button type="button" onClick={() => void sync.checkNow()} disabled={s.isSyncing || !s.selectedAccountId} className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50" title="Delta-Sync jetzt starten">Sync</button>
              <a href="/search" className="glass-btn rounded-lg px-2 py-1 text-center text-xs" title="Erweiterte Suche">Detailsuche</a>
              <a href="/duplicates" className="glass-btn rounded-lg px-2 py-1 text-center text-xs" title="Duplikate erkennen">Duplikate</a>
              <a href="/settings" className="glass-btn rounded-lg px-2 py-1 text-center text-xs" title="Einstellungen">Settings</a>
              <a href="/sender-profiles" className="glass-btn rounded-lg px-2 py-1 text-center text-xs" title="Absender-Profile">Absender</a>
              <a href="/ai-assistant" className="glass-btn rounded-lg px-2 py-1 text-center text-xs" title="KI-Assistent">AI</a>
            </div>
            <div className="space-y-2 rounded-lg border border-white/25 bg-white/10 p-2 lg:hidden">
              <p className="text-[11px] font-semibold uppercase tracking-wide glass-text-muted">Swipe-Aktionen</p>
              <label className="block text-xs glass-text-secondary">
                Links wischen
                <select value={s.leftSwipeAction} onChange={(e) => setLeftSwipeActionPersist(e.target.value as MobileSwipeAction)} className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs" aria-label="Aktion bei Swipe nach links" title="Aktion bei Swipe nach links">
                  {MOBILE_SWIPE_ACTION_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </label>
              <label className="block text-xs glass-text-secondary">
                Rechts wischen
                <select value={s.rightSwipeAction} onChange={(e) => setRightSwipeActionPersist(e.target.value as MobileSwipeAction)} className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs" aria-label="Aktion bei Swipe nach rechts" title="Aktion bei Swipe nach rechts">
                  {MOBILE_SWIPE_ACTION_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </label>
            </div>
          </div>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto overflow-x-hidden py-1 text-sm">
            {s.folders.length === 0 ? (
              <p className="px-3 py-2 text-xs glass-text-muted">{s.selectedAccountId ? "Lade Ordner..." : "Kein Konto gewählt."}</p>
            ) : (
              <ul>
                <li>
                  <button onClick={() => s.setAccountExpanded((v) => !v)} className="flex w-full items-center gap-1 px-2 py-1 text-left text-sm font-semibold glass-text-primary hover:bg-white/30" title={s.selectedAccount?.name ?? s.accountRootLabel}>
                    <span className="flex h-6 w-5 shrink-0 items-center justify-center text-[10px] glass-text-muted">{s.accountExpanded ? "▼" : "▶"}</span>
                    <span className="truncate">{s.accountRootLabel}</span>
                  </button>
                  {s.accountExpanded ? (
                    <ul>
                      {s.folderTree.map((node) => (
                        <FolderTreeRow
                          key={node.path}
                          node={node}
                          depth={1}
                          expanded={s.effectiveExpandedFolderPaths}
                          onToggle={toggleFolderExpanded}
                          selectedPath={s.selectedFolderPath}
                          countDisplayMode={s.folderCountDisplayMode}
                          dragOverPath={s.dragOverFolderPath ?? undefined}
                          onDragOver={onFolderDragOver}
                          onDragLeave={onFolderDragLeave}
                          onDrop={onFolderDrop}
                          onFolderDrop={actions.handleFolderMoveByDrag}
                          onSelect={onFolderSelect}
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              </ul>
            )}
            {s.labelList.length > 0 || !s.isAllAccounts ? (
              <div className="mt-2 border-t glass-divider pt-2">
                <button onClick={() => s.setLabelsExpanded((v) => !v)} className="flex w-full items-center gap-1 px-2 py-1 text-left text-sm font-semibold glass-text-primary hover:bg-white/30">
                  <span className="flex h-6 w-5 shrink-0 items-center justify-center text-[10px] glass-text-muted">{s.labelsExpanded ? "▼" : "▶"}</span>
                  <span className="truncate">Labels</span>
                </button>
                {s.labelsExpanded ? (
                  <ul className="space-y-0.5 pl-1">
                    {s.labelList.map((label) => (
                      <li key={label.id}>
                        <button
                          onClick={() => { void sync.loadEmailsByLabel(label.name); openMobilePane("middle"); }}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-1 text-left text-sm transition-colors ${s.selectedLabel === label.name ? "glass-active" : "glass-text-secondary hover:bg-white/30"}`}
                        >
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: label.color ?? "#6b7280" }} />
                          <span className="min-w-0 flex-1 truncate">{label.name}</span>
                          <span className={`shrink-0 text-xs tabular-nums ${s.selectedLabel === label.name ? "text-white/80" : "glass-text-muted"}`}>{label.emailCount > 0 ? label.emailCount : ""}</span>
                        </button>
                      </li>
                    ))}
                    <li><a href="/labels" className="flex items-center gap-2 rounded-lg px-3 py-1 text-left text-xs glass-text-muted hover:bg-white/30">Labels verwalten</a></li>
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {s.foldersOpen && folderResizeHandle ? folderResizeHandle : null}

      {/* ---- Email list section (middle pane) ---- */}
      <section className="glass-subtle relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden border-r-0 lg:flex-none lg:w-[var(--mp-list-w)] lg:shrink-0">
        <div className="flex items-center gap-3 border-b glass-divider px-3 py-2">
          <div className="flex gap-3 text-sm">
            <button onClick={() => s.setTab("all")} className={`relative pb-1 ${s.tab === "all" ? "font-semibold glass-text-primary after:absolute after:inset-x-0 after:-bottom-[5px] after:h-[2px] after:bg-current" : "glass-text-muted hover:opacity-80"}`}>Alle</button>
            <button onClick={() => s.setTab("unread")} className={`relative pb-1 ${s.tab === "unread" ? "font-semibold glass-text-primary after:absolute after:inset-x-0 after:-bottom-[5px] after:h-[2px] after:bg-current" : "glass-text-muted hover:opacity-80"}`}>Ungelesen</button>
          </div>
          <select value={s.sort} onChange={(e) => s.setSort(e.target.value as typeof s.sort)} className="glass-select ml-auto rounded-lg px-2 py-1 text-xs">
            <option value="date_desc">Neueste</option>
            <option value="date_asc">Älteste</option>
            <option value="from_asc">Absender A-Z</option>
            <option value="subject_asc">Betreff A-Z</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b glass-divider px-3 py-2">
          <label className="flex items-center gap-1 text-xs glass-text-secondary">
            <input
              type="checkbox"
              checked={s.emails.length > 0 && s.emails.every((e) => s.selectedIds.has(e.id))}
              ref={(el) => {
                if (el) {
                  const someSelected = s.emails.some((e) => s.selectedIds.has(e.id));
                  const allSelected = s.emails.length > 0 && s.emails.every((e) => s.selectedIds.has(e.id));
                  el.indeterminate = someSelected && !allSelected;
                }
              }}
              onChange={toggleSelectAllVisible}
            />
            Alle
          </label>
          <button onClick={() => s.setHasAttachmentsFilter((v) => !v)} className={`rounded-full px-2 py-0.5 text-xs transition-all ${s.hasAttachmentsFilter ? "glass-btn-dark" : "glass-btn"}`}>Mit Anhängen</button>
          <button onClick={() => s.setActionRequiredFilter((v) => !v)} className={`rounded-full px-2 py-0.5 text-xs transition-all ${s.actionRequiredFilter ? "glass-btn-dark" : "glass-btn"}`}>Aktion erforderlich</button>
          <label className="ml-auto flex items-center gap-1 text-xs glass-text-secondary">
            <span>Flag</span>
            <select value={s.localFlagFilter} onChange={(e) => s.setLocalFlagFilter(e.target.value as LocalFlagFilter)} className="glass-select rounded-lg px-2 py-1 text-xs">
              <option value="all">Alle</option>
              <option value="none">Ohne</option>
              <option value="red">Rot</option>
              <option value="yellow">Gelb</option>
              <option value="green">Grün</option>
            </select>
          </label>
          {s.folderEmptyKind ? (
            <button onClick={() => { s.setEmptyConfirmText(""); s.setEmptyFolderModalOpen(true); }} className="glass-btn ml-auto rounded-lg px-2 py-0.5 text-xs text-red-600" title={s.folderEmptyKind === "trash" ? "Alle Mails im Papierkorb endgültig entfernen" : "Alle Mails im Spam-Ordner endgültig entfernen"}>
              {s.folderEmptyKind === "trash" ? "Papierkorb leeren" : "Spam leeren"}
            </button>
          ) : null}
        </div>

        {s.selectedIds.size > 0 ? (
          <div className="glass-info flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="font-medium">{s.selectedIds.size} ausgewählt</span>
            <span className="glass-text-muted">— Rechtsklick für Aktionen</span>
            <button onClick={() => s.setSelectedIds(new Set())} className="glass-btn ml-auto rounded-lg px-2 py-1">✕ Aufheben</button>
          </div>
        ) : null}

        <div ref={s.listScrollRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
          {s.isLoadingEmails ? <p className="px-4 py-3 text-sm glass-text-secondary">Lade E-Mails...</p> : null}
          {!s.isLoadingEmails && s.emails.length === 0 ? (
            <p className="px-4 py-6 text-sm glass-text-muted">Keine E-Mails für die aktuellen Filter.</p>
          ) : null}
          <ul className="divide-y glass-divider overflow-x-hidden">
            {s.emails.map((email) => {
              const unread = isUnread(email);
              const sender = senderDisplayName(email);
              const seed = email.fromEmail || email.fromName || email.id;
              const isSelected = s.selectedEmail?.id === email.id;
              const isChecked = s.selectedIds.has(email.id);
              const localFlag = email.localFlag ?? null;
              const indexedAttachmentCount = email.attachmentCount ?? 0;
              const attachmentCount = indexedAttachmentCount > 0 ? indexedAttachmentCount : email.hasAttachments ? 1 : email.attachments?.length ?? 0;
              const attachmentNames = (email.attachments ?? []).map((a) => getAttachmentDisplayName(a)).filter(Boolean);
              const visibleAttachmentNames = attachmentNames.slice(0, 2);
              const hiddenAttachmentNames = Math.max(0, attachmentCount - visibleAttachmentNames.length);
              const swipeOffset = s.mailSwipeOffsets[email.id] ?? 0;
              const swipePreviewDirection = swipeOffset < -42 ? "left" : swipeOffset > 42 ? "right" : null;
              const swipePreviewAction = swipePreviewDirection ? getSwipeActionForDirection(swipePreviewDirection) : "none";
              const swipeFeedbackAction = s.mailSwipeFeedback[email.id];
              const swipeActiveLabel = swipeFeedbackAction ? getMobileSwipeActionLabel(swipeFeedbackAction) : getMobileSwipeActionLabel(swipePreviewAction);

              return (
                <li key={email.id} className="min-w-0 overflow-x-hidden">
                  <div className={`relative overflow-hidden rounded-xl ${swipeOffset !== 0 ? "bg-blue-500/15" : ""}`} data-mail-row-swipe>
                    <div
                      className={`pointer-events-none absolute inset-0 z-0 flex items-center px-3 text-xs font-semibold transition-opacity ${
                        swipePreviewDirection || swipeFeedbackAction ? "opacity-100" : "opacity-0"
                      } ${
                        swipePreviewDirection === "right" || (swipeFeedbackAction && getSwipeActionForDirection("right") === swipeFeedbackAction && swipeOffset >= 0) ? "justify-start text-emerald-700" : "justify-end text-blue-700"
                      }`}
                      aria-hidden
                    >
                      {swipePreviewDirection || swipeFeedbackAction ? swipeActiveLabel : ""}
                    </div>
                    <div
                      draggable
                      onDragStart={(e) => {
                        const dragIds = s.selectedIds.size > 1 && s.selectedIds.has(email.id) ? Array.from(s.selectedIds) : [email.id];
                        e.dataTransfer.setData("text/x-mailpilot-email-id", email.id);
                        e.dataTransfer.setData("text/x-mailpilot-email-ids", JSON.stringify(dragIds));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onContextMenu={(e) => openMailContextMenu(e, email)}
                      onTouchStart={(e) => handleMailRowSwipeStart(email.id, e)}
                      onTouchMove={(e) => handleMailRowSwipeMove(email.id, e)}
                      onTouchEnd={(e) => { void handleMailRowSwipeEnd(email, e); }}
                      style={{ transform: `translateX(${swipeOffset}px)` }}
                      className={`flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-xl px-2 py-2 text-left transition-all cursor-grab active:cursor-grabbing ${isSelected || isChecked ? "glass-selected border-2" : "border-2 border-transparent hover:bg-white/40"}`}
                    >
                      <div className="mt-2 flex shrink-0 flex-col items-center gap-3 px-1" onClick={(e) => e.stopPropagation()}>
                        <label className="flex cursor-pointer items-center" onClick={(e) => { e.preventDefault(); toggleSelected(email.id, e.shiftKey); }}>
                          <input type="checkbox" checked={isChecked} readOnly aria-label="E-Mail auswählen" />
                        </label>
                        <button onClick={() => { void actions.runActionForEmail(email.id, `/api/emails/${email.id}/move`, { targetSpecial: "trash" }); }} className="rounded p-0.5 text-gray-400 hover:text-red-600 transition-colors" aria-label="In Papierkorb verschieben" title="Papierkorb">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                      </div>
                      <div className="flex min-w-0 flex-1 items-start gap-2 overflow-hidden">
                        <button
                          onClick={(e) => { if (e.shiftKey) { toggleSelected(email.id, true); return; } sync.loadEmail(email.id); }}
                          onDoubleClick={(e) => { e.preventDefault(); s.setPopupEmailId(email.id); }}
                          className="flex min-w-0 flex-1 items-start gap-3 overflow-hidden text-left"
                        >
                          <span className="mt-0.5 flex shrink-0 flex-col items-center gap-1">
                            <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ${getAvatarColor(seed)}`}>{getInitials(email.fromName, email.fromEmail)}</span>
                            {attachmentCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-blue-700"><path d="M21.44 11.05l-8.49 8.49a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.82-2.83l8.48-8.48" /></svg>
                                <span className="leading-none">{attachmentCount}</span>
                              </span>
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-1"><span className={`min-w-0 truncate text-sm ${unread ? "font-semibold glass-text-primary" : "glass-text-secondary"}`}>{sender}</span></span>
                            <span className="flex items-baseline justify-between gap-1"><span className={`min-w-0 truncate text-sm ${unread ? "font-semibold glass-text-primary" : "glass-text-secondary"}`}>{email.subject || "(Ohne Betreff)"}</span></span>
                            <span className="block text-xs tabular-nums glass-text-secondary">{formatDateTimeShort(email.date ?? email.createdAt)}</span>
                            <span className="block truncate text-xs glass-text-muted">{email.snippet ?? ""}</span>
                            {attachmentCount > 0 ? (
                              <span className="mt-1 block truncate text-[11px] text-blue-700">
                                Anhaenge: {visibleAttachmentNames.length > 0 ? visibleAttachmentNames.join(", ") : "Anhang"}{hiddenAttachmentNames > 0 ? ` +${hiddenAttachmentNames} weitere` : ""}
                              </span>
                            ) : null}
                            <span className="mt-1 flex flex-wrap gap-1">
                              {(() => { const badge = getAccountBadgeInfo(s.accounts, email.accountId); if (!badge) return null; return (<span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: badge.bg, color: badge.text }}>{badge.label}</span>); })()}
                              {email.aiCategory ? <span className="glass-badge-accent text-[10px]">{email.aiCategory}</span> : null}
                              {email.aiPriority && email.aiPriority !== "normal" ? <span className="glass-badge text-[10px]" style={{ color: "var(--text-secondary)" }}>{email.aiPriority}</span> : null}
                              {email.actionRequired ? <span className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] text-red-600">Aktion</span> : null}
                            </span>
                          </span>
                        </button>
                        <div className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
                          <div className="flex flex-col gap-1">
                            {(Object.keys(LOCAL_FLAG_META) as Array<"red" | "yellow" | "green">).map((flagValue) => {
                              const meta = LOCAL_FLAG_META[flagValue];
                              const active = localFlag === flagValue;
                              return (
                                <button key={flagValue} type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void actions.setLocalFlag(email.id, active ? null : flagValue); }} aria-label={`Flag ${meta.label} ${active ? "entfernen" : "setzen"}`} title={`Flag ${meta.label}`} className={`h-5 w-5 rounded-full border text-[10px] leading-none transition-all ${active ? meta.className : "border-slate-300/70 bg-white/55 text-slate-300 hover:border-slate-400 hover:text-slate-500"}`}>●</button>
                              );
                            })}
                          </div>
                          {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" /> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {s.emails.length > 0 && s.emailsHasMore ? <div ref={s.loadMoreSentinelRef} className="h-px w-full shrink-0" aria-hidden /> : null}
          {s.isLoadingMoreEmails ? <p className="px-4 py-3 text-center text-xs glass-text-muted">Lade weitere Mails…</p> : null}
          {!s.isLoadingEmails && s.emails.length > 0 && !s.emailsHasMore ? <p className="px-4 py-3 text-center text-xs text-gray-400">Alle geladenen Mails angezeigt.</p> : null}
        </div>
      </section>
    </>
  );
}
