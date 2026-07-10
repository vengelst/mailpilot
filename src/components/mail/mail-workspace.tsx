"use client";

import {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { buildSafeMailDocument } from "@/lib/sanitizeMailHtml";
import { linkifyMailPlainText } from "@/lib/linkifyMailPlainText";
import { EmailDetailModal } from "@/components/mail/email-detail-modal";
import {
  DEFAULT_MAIL_SCROLL_BATCH,
  snapMailScrollBatchSize,
  type MailScrollBatchOption,
} from "@/lib/mailScrollBatch";
import { ThemeToggle } from "@/components/theme-toggle";

// ---- Drei-Spalten-Layout: Drag-Handle zwischen den Spalten ----

const FOLDER_WIDTH_DEFAULT = 280;
const FOLDER_WIDTH_MIN = 220;
const FOLDER_WIDTH_MAX = 460;
const LIST_WIDTH_DEFAULT = 430;
const LIST_WIDTH_MIN = 320;
const LIST_WIDTH_MAX = 700;

const FOLDER_LS_KEY = "mailpilot.layout.folderWidth";
const LIST_LS_KEY = "mailpilot.layout.listWidth";
const MOBILE_MAIN_HEADER_LS_KEY = "mailpilot.layout.mobileMainHeaderExpanded";
const FOLDER_COUNT_MODE_LS_KEY = "mailpilot.layout.folderCountMode";
const MOBILE_SWIPE_LEFT_ACTION_LS_KEY = "mailpilot.mobileSwipe.leftAction";
const MOBILE_SWIPE_RIGHT_ACTION_LS_KEY = "mailpilot.mobileSwipe.rightAction";
const FOLDER_REFRESH_INTERVAL_MS = 60 * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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
type Account = {
  id: string;
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  isDefault?: boolean;
};

const ACCOUNT_COLORS = [
  { bg: "#dbeafe", text: "#1e40af" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#ede9fe", text: "#5b21b6" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#ccfbf1", text: "#115e59" },
];

function getAccountBadgeInfo(
  accounts: Account[],
  accountId: string,
): { label: string; bg: string; text: string } | null {
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return null;
  const account = accounts[idx];
  const raw = account.name || account.imapUsername?.split("@")[0] || "";
  const label = raw.length > 8 ? raw.slice(0, 8) : raw;
  const color = ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
  return { label, bg: color.bg, text: color.text };
}

type Folder = {
  path: string;
  displayName: string;
  delimiter?: string | null;
  specialUse?: string;
  unreadCount?: number;
  totalCount?: number;
  existsCount?: number;
};

type AutomationRunSummary = {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
};

type FolderTreeNode = {
  segment: string;
  path: string;
  folder?: Folder;
  children: FolderTreeNode[];
};

function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const root: FolderTreeNode = { segment: "", path: "", children: [] };
  const sorted = [...folders].sort((a, b) => a.path.localeCompare(b.path));
  for (const folder of sorted) {
    const delimiter = folder.delimiter || "/";
    const segments = folder.path.split(delimiter).filter(Boolean);
    if (segments.length === 0) continue;
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const fullPath = segments.slice(0, i + 1).join(delimiter);
      let child = node.children.find((c) => c.segment === segment);
      if (!child) {
        child = { segment, path: fullPath, children: [] };
        node.children.push(child);
      }
      if (i === segments.length - 1) {
        child.folder = folder;
      }
      node = child;
    }
  }
  const sortNodes = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) => {
      const aInbox = a.folder?.specialUse === "inbox" ? 0 : 1;
      const bInbox = b.folder?.specialUse === "inbox" ? 0 : 1;
      if (aInbox !== bInbox) return aInbox - bInbox;
      return a.segment.localeCompare(b.segment, "de", { sensitivity: "base" });
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

function ancestorPaths(path: string, delimiter: string): string[] {
  const segments = path.split(delimiter).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    out.push(segments.slice(0, i + 1).join(delimiter));
  }
  return out;
}

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
  node,
  depth,
  expanded,
  onToggle,
  selectedPath,
  onSelect,
  countDisplayMode,
  dragOverPath,
  onDragOver,
  onDragLeave,
  onDrop,
  onFolderDrop,
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

type Attachment = {
  id: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  cloudProvider: "google_drive" | "onedrive" | null;
  cloudPath: string | null;
  saveStatus: "not_saved" | "saved" | "error";
  saveError: string | null;
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
};

function getAttachmentDisplayName(attachment: Attachment) {
  const raw = attachment.filename?.trim() ?? "";
  if (raw) return raw;
  const ext = attachment.mimeType ? MIME_EXTENSION_MAP[attachment.mimeType.toLowerCase()] : undefined;
  return ext ? `Anhang.${ext}` : "Anhang";
}

function getAttachmentPreviewType(attachment: Attachment): "image" | "pdf" | null {
  const mime = (attachment.mimeType || "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  const ext = (attachment.filename || "").split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return null;
}

type Email = {
  id: string;
  accountId: string;
  folderPath: string;
  subject: string | null;
  fromName?: string | null;
  fromEmail: string | null;
  toEmails?: string[];
  ccEmails?: string[];
  date: string | null;
  createdAt?: string | null;
  snippet: string | null;
  textPreview: string | null;
  hasAttachments?: boolean;
  attachmentCount?: number;
  flags: string[];
  localFlag?: "red" | "yellow" | "green" | null;
  aiSummaryShort: string | null;
  aiSummaryLong?: string | null;
  aiCategory: string | null;
  aiPriority: string | null;
  actionRequired?: boolean;
  labels?: string[];
  attachments: Attachment[];
};

type LocalFlagFilter = "all" | "none" | "red" | "yellow" | "green";
type MobileSwipeAction = "none" | "trash" | "mark_read" | "mark_unread" | "print";
type PendingSwipeTrashUndo = {
  id: string;
  email: Email;
  originalIndex: number;
  sourceAccountId: string;
  sourceFolderPath: string;
  timeoutId: number;
};

const MOBILE_SWIPE_ACTION_OPTIONS: Array<{ value: MobileSwipeAction; label: string }> = [
  { value: "none", label: "Keine Aktion" },
  { value: "trash", label: "Papierkorb" },
  { value: "mark_read", label: "Als gelesen" },
  { value: "mark_unread", label: "Als ungelesen" },
  { value: "print", label: "Drucken" },
];

const LOCAL_FLAG_META: Record<Exclude<LocalFlagFilter, "all" | "none">, { label: string; className: string }> = {
  red: { label: "Rot", className: "border-red-600 bg-red-500 text-white shadow-sm shadow-red-500/30" },
  yellow: {
    label: "Gelb",
    className: "border-amber-500 bg-amber-400 text-amber-950 shadow-sm shadow-amber-400/30",
  },
  green: {
    label: "Grün",
    className: "border-emerald-600 bg-emerald-500 text-white shadow-sm shadow-emerald-500/30",
  },
};

type MailContextMenuState = {
  x: number;
  y: number;
  emailId: string;
  targetIds: string[];
};

type SignatureData = {
  id: string;
  name: string;
  htmlContent: string;
  accountIds: string[];
  includeOnNewMail: boolean;
  includeOnReply: boolean;
  includeOnForward: boolean;
  isDefault: boolean;
};

type ComposeMode = "new" | "reply" | "forward";

type ComposeForm = {
  draftId: string | null;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  sendAtLocal: string;
};

type ContactCandidate = {
  id: string;
  emailId: string;
  companyName: string | null;
  personName: string | null;
  email: string | null;
  phone: string | null;
  status: "pending" | "exported" | "ignored" | "duplicate";
  confidence: number | null;
};

const AVATAR_PALETTE = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-rose-500",
];

function getInitials(name?: string | null, email?: string | null) {
  const source = (name && name.trim()) || (email && email.trim()) || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function getAvatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function senderDisplayName(email: Pick<Email, "fromName" | "fromEmail">) {
  return (email.fromName && email.fromName.trim()) || email.fromEmail || "Unbekannt";
}

function folderDisplayName(path: string) {
  const clean = path.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return path;
  const segments = clean.split(/[/.]/).filter(Boolean);
  return segments[segments.length - 1] || clean;
}

function formatDateTimeShort(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  const datePart = d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
  const timePart = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

function formatDetailDate(value: string | Date | null | undefined) {
  if (value == null) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  return d.toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toMailtoPlainText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildMailtoQuote(email: Email, intro: string) {
  const preview = toMailtoPlainText(email.textPreview ?? email.snippet).slice(0, 1200);
  const headerLines = [
    intro,
    `Von: ${senderDisplayName(email)}${email.fromEmail ? ` <${email.fromEmail}>` : ""}`,
    `Datum: ${formatDetailDate(email.date)}`,
    `Betreff: ${email.subject ?? ""}`,
  ];
  return preview ? `\n\n${headerLines.join("\n")}\n\n${preview}` : `\n\n${headerLines.join("\n")}`;
}

function parseRecipientList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function plainToHtml(value: string) {
  const escaped = escapeHtml(value);
  return escaped.replace(/\n/g, "<br/>");
}

function stripHtml(value: string) {
  if (typeof document === "undefined") return value;
  const container = document.createElement("div");
  container.innerHTML = value;
  return (container.textContent || container.innerText || "").trim();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(Math.abs(diffMs) / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} h`;
  const diffDays = Math.round(diffHours / 24);
  return `vor ${diffDays} d`;
}

function formatStatusBadge(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "success") {
    return {
      label: "Erfolg",
      className: "border-emerald-500/35 bg-emerald-500/15 text-emerald-700",
    };
  }
  if (normalized === "running") {
    return {
      label: "Läuft",
      className: "border-amber-500/35 bg-amber-500/15 text-amber-700",
    };
  }
  if (normalized === "failed") {
    return {
      label: "Fehler",
      className: "border-red-500/35 bg-red-500/15 text-red-700",
    };
  }
  return {
    label: status || "Unbekannt",
    className: "border-slate-400/35 bg-slate-500/10 glass-text-secondary",
  };
}

export function MailWorkspace() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState("INBOX");
  const [moveTargetFolder, setMoveTargetFolder] = useState("");
  const [query, setQuery] = useState("");
  const [uiError, setUiError] = useState("");
  const [uiInfo, setUiInfo] = useState("");
  const [senderProfileToast, setSenderProfileToast] = useState<{
    fromEmail: string;
    fromName: string;
    targetFolder: string;
    emailId: string;
  } | null>(null);
  const senderProfileToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingMoreEmails, setIsLoadingMoreEmails] = useState(false);
  const [emailsHasMore, setEmailsHasMore] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<
    | {
        kind: "incremental" | "full" | "all_folders";
        label: string;
        totalMails?: number;
        processedMails?: number;
        remainingMails?: number;
        etaSeconds?: number | null;
        isEstimate?: boolean;
        lastFolderPath?: string | null;
      }
    | null
  >(null);
  const [mobilePane, setMobilePane] = useState<"left" | "middle" | "right">("middle");
  const [, setMobileDrawerDragX] = useState(0);
  const [leftSwipeAction, setLeftSwipeAction] = useState<MobileSwipeAction>("trash");
  const [rightSwipeAction, setRightSwipeAction] = useState<MobileSwipeAction>("mark_read");
  const [mailSwipeOffsets, setMailSwipeOffsets] = useState<Record<string, number>>({});
  const [mailSwipeFeedback, setMailSwipeFeedback] = useState<Record<string, MobileSwipeAction>>({});
  const [pendingSwipeTrashUndos, setPendingSwipeTrashUndos] = useState<PendingSwipeTrashUndo[]>([]);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [hasAttachmentsFilter, setHasAttachmentsFilter] = useState(false);
  const [actionRequiredFilter, setActionRequiredFilter] = useState(false);
  const [localFlagFilter, setLocalFlagFilter] = useState<LocalFlagFilter>("all");
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "from_asc" | "subject_asc">(
    "date_desc",
  );
  const [contactCandidates, setContactCandidates] = useState<ContactCandidate[]>([]);
  const [attachmentTargets, setAttachmentTargets] = useState<
    Record<string, { provider: "google_drive" | "onedrive" | "mock"; targetPath: string }>
  >({});
  const [emailDetailMenuOpen, setEmailDetailMenuOpen] = useState(false);
  const [maximizedBodyMenuOpen, setMaximizedBodyMenuOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [mobileMainHeaderExpanded, setMobileMainHeaderExpanded] = useState(true);
  const [accountExpanded, setAccountExpanded] = useState(true);
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(new Set());
  const [bodyContent, setBodyContent] = useState<{ text: string; html: string } | null>(null);
  const [isLoadingBody, setIsLoadingBody] = useState(false);
  const [bodyError, setBodyError] = useState("");
  const [bodyMode, setBodyMode] = useState<"text" | "html">("html");
  const [showExternalImages, setShowExternalImages] = useState(false);
  const [printMode, setPrintMode] = useState<"html" | "text">("html");
  const [isBodyMaximized, setIsBodyMaximized] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);
  const shiftHeldRef = useRef(false);
  const [emptyFolderModalOpen, setEmptyFolderModalOpen] = useState(false);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null);
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState<Set<string>>(new Set());
  const dragExpandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emptyConfirmText, setEmptyConfirmText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const [newMailCheckIntervalMinutes, setNewMailCheckIntervalMinutes] = useState(30);
  const [runOnAppStart, setRunOnAppStart] = useState(false);
  const [folderCountDisplayMode, setFolderCountDisplayMode] = useState<"compact" | "uga">("compact");
  const [automationRuns, setAutomationRuns] = useState<AutomationRunSummary[]>([]);
  const [automationDashboardOpen, setAutomationDashboardOpen] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationRunningNow, setAutomationRunningNow] = useState(false);
  const [mailScrollBatchSize, setMailScrollBatchSize] =
    useState<MailScrollBatchOption>(DEFAULT_MAIL_SCROLL_BATCH);
  const [mailContextMenu, setMailContextMenu] = useState<MailContextMenuState | null>(null);
  const [contextMoveTargetFolder, setContextMoveTargetFolder] = useState("");
  const [contextAttachmentId, setContextAttachmentId] = useState("");
  const [signatures, setSignatures] = useState<SignatureData[]>([]);
  const [popupEmailId, setPopupEmailId] = useState<string | null>(null);
  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null);
  const [isManagingFolder, setIsManagingFolder] = useState(false);
  const [mobileMovePanelOpen, setMobileMovePanelOpen] = useState(false);
  const [mobileNewFolderName, setMobileNewFolderName] = useState("");
  const [mobileNewFolderParentPath, setMobileNewFolderParentPath] = useState("");

  // --- Label system ---
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [labelList, setLabelList] = useState<{ id: string; name: string; color: string | null; emailCount: number }[]>([]);
  const [labelsExpanded, setLabelsExpanded] = useState(true);
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false);
  const [newLabelInline, setNewLabelInline] = useState("");

  // --- Auto-Prompt (Feature 1) ---
  const [checkedSenders] = useState(() => new Set<string>());
  const [senderPromptVisible, setSenderPromptVisible] = useState(false);
  const [senderPromptData, setSenderPromptData] = useState<{
    email: string;
    domain: string;
    fromName: string;
  } | null>(null);
  const [senderPromptCategory, setSenderPromptCategory] = useState("Sonstiges");
  const [senderPromptFolder, setSenderPromptFolder] = useState("");
  const [senderPromptSaving, setSenderPromptSaving] = useState(false);

  // --- Auto-move toast (Feature 2) ---
  const [autoMoveToast, setAutoMoveToast] = useState<{ emailId: string; folder: string } | null>(null);
  const autoMoveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoMoveRef = useRef<{ emailId: string; folder: string } | null>(null);

  const composeEditorRef = useRef<HTMLDivElement | null>(null);
  const mailBodyIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [composeSaving, setComposeSaving] = useState(false);
  const [composeForm, setComposeForm] = useState<ComposeForm>({
    draftId: null,
    accountId: "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    bodyHtml: "",
    sendAtLocal: "",
  });
  const autoCheckInFlightRef = useRef(false);
  const syncAllProgressPollRef = useRef<number | null>(null);
  const automationRefreshRef = useRef<number | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreEmailsRef = useRef<() => Promise<void>>(async () => {});
  const emailsNextCursorRef = useRef<string | null>(null);
  const emailsHasMoreRef = useRef(false);
  const isLoadingEmailsRef = useRef(false);
  const pendingSwipeTrashUndosRef = useRef<PendingSwipeTrashUndo[]>([]);
  const selectedAccountIdRef = useRef(selectedAccountId);
  const selectedFolderPathRef = useRef(selectedFolderPath);
  const swipeTrashUndoSeqRef = useRef(0);
  const activeLoadEmailsRequestIdRef = useRef(0);
  const activeLoadEmailRequestIdRef = useRef(0);
  const mobileDrawerGestureRef = useRef<{ x: number; y: number; pane: "left" | "middle" | "right" } | null>(
    null,
  );
  const mailRowSwipeStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const swipeFeedbackTimeoutsRef = useRef<Record<string, number>>({});

  // Three-column resizable layout (only takes effect on lg+; mobile keeps the
  // existing list/detail toggle). Initial values are static so SSR and the
  // first client render match — we hydrate from localStorage in a useEffect.
  const [folderWidth, setFolderWidth] = useState(FOLDER_WIDTH_DEFAULT);
  const [listWidth, setListWidth] = useState(LIST_WIDTH_DEFAULT);

  const selectedEmailCandidates = useMemo(() => {
    if (!selectedEmail) return [];
    return contactCandidates.filter((candidate) => candidate.emailId === selectedEmail.id);
  }, [contactCandidates, selectedEmail]);

  // Sanitize the IMAP-supplied HTML body once per mail. Both the inline iframe
  // and the maximised modal use the same sanitized document — DOMPurify strips
  // scripts/handlers/external images, the wrapper sets a tight CSP, and the
  // host iframe still has `sandbox=""` so even bypasses cannot execute JS.
  const safeMailDocument = useMemo(
    () => (bodyContent?.html ? buildSafeMailDocument(bodyContent.html, { allowExternalImages: showExternalImages }) : ""),
    [bodyContent, showExternalImages],
  );

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const effectiveExpandedFolderPaths = useMemo(() => {
    const next = new Set(expandedFolderPaths);
    if (selectedFolderPath) {
      const folder = folders.find((f) => f.path === selectedFolderPath);
      const delimiter = folder?.delimiter || "/";
      for (const a of ancestorPaths(selectedFolderPath, delimiter)) next.add(a);
    }
    return next;
  }, [expandedFolderPaths, selectedFolderPath, folders]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  const accountRootLabel = selectedAccount?.imapUsername || selectedAccount?.name || "Konto";

  const currentFolder = useMemo(
    () => folders.find((f) => f.path === selectedFolderPath) ?? null,
    [folders, selectedFolderPath],
  );
  const latestAutomationRun = automationRuns[0] ?? null;
  const latestRunStartedAt = latestAutomationRun?.startedAt ?? null;
  const nextScheduledRunAt = useMemo(() => {
    if (!latestRunStartedAt) return null;
    const base = new Date(latestRunStartedAt).getTime();
    if (!Number.isFinite(base)) return null;
    return new Date(base + Math.max(5, Math.round(newMailCheckIntervalMinutes)) * 60 * 1000).toISOString();
  }, [latestRunStartedAt, newMailCheckIntervalMinutes]);
  // Detect Trash/Spam locally so we can show the "Leeren" button — the server
  // does its own classification before actually purging.
  const folderEmptyKind: "trash" | "spam" | null = useMemo(() => {
    if (!currentFolder) return null;
    if (currentFolder.specialUse === "trash") return "trash";
    if (currentFolder.specialUse === "spam") return "spam";
    const lower = currentFolder.path.toLowerCase();
    if (/trash|papierkorb|deleted|gel(ö|oe)scht|\bbin\b/.test(lower)) return "trash";
    if (/spam|junk|unerw(ü|ue)nscht|werbung/.test(lower)) return "spam";
    return null;
  }, [currentFolder]);

  const contextMenuEmail = useMemo(() => {
    if (!mailContextMenu) return null;
    return emails.find((email) => email.id === mailContextMenu.emailId) ?? null;
  }, [mailContextMenu, emails]);
  const contextMenuTargetIds = mailContextMenu?.targetIds ?? [];
  const contextMenuIsBulk = contextMenuTargetIds.length > 1;
  const contextMenuAttachments = contextMenuEmail?.attachments ?? [];
  const selectedContextAttachment =
    contextMenuAttachments.find((attachment) => attachment.id === contextAttachmentId) ??
    contextMenuAttachments[0] ??
    null;
  const mobileNewFolderParentOptions = useMemo(() => {
    return folders
      .map((folder) => folder.path)
      .filter((path) => path.trim().length > 0)
      .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
  }, [folders]);
  const hasSelectedEmail = !!selectedEmail;
  const mobileSwipeLabelByAction: Record<MobileSwipeAction, string> = {
    none: "Keine Aktion",
    trash: "Papierkorb",
    mark_read: "Als gelesen",
    mark_unread: "Als ungelesen",
    print: "Drucken",
  };
  const rightDrawerEnabled = hasSelectedEmail;
  const isMobileLeftPaneVisible = foldersOpen && mobilePane === "left";
  const isMobileRightPaneVisible = mobilePane === "right" && rightDrawerEnabled;
  const isMobileDrawerOpen = isMobileLeftPaneVisible || isMobileRightPaneVisible;

  function clearSelection() {
    setSelectedIds(new Set());
  }
  function getMobileSwipeActionLabel(action: MobileSwipeAction) {
    return mobileSwipeLabelByAction[action];
  }
  function getSwipeActionForDirection(direction: "left" | "right"): MobileSwipeAction {
    return direction === "left" ? leftSwipeAction : rightSwipeAction;
  }
  function persistMobileSwipeActions(nextLeft: MobileSwipeAction, nextRight: MobileSwipeAction) {
    setLeftSwipeAction(nextLeft);
    setRightSwipeAction(nextRight);
    try {
      window.localStorage.setItem(MOBILE_SWIPE_LEFT_ACTION_LS_KEY, nextLeft);
      window.localStorage.setItem(MOBILE_SWIPE_RIGHT_ACTION_LS_KEY, nextRight);
    } catch {
      // ignore storage errors
    }
  }
  function setLeftSwipeActionPersist(next: MobileSwipeAction) {
    persistMobileSwipeActions(next, rightSwipeAction);
  }
  function setRightSwipeActionPersist(next: MobileSwipeAction) {
    persistMobileSwipeActions(leftSwipeAction, next);
  }
  function openMobilePane(nextPane: "left" | "middle" | "right") {
    if (nextPane === "right" && !hasSelectedEmail) {
      setMobilePane("middle");
      return;
    }
    if (nextPane === "left") {
      setFoldersOpen(true);
    }
    setMobilePane(nextPane);
  }
  function handleDrawerGestureStart(e: ReactTouchEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-mail-row-swipe]")) return;
    const touch = e.touches[0];
    if (!touch) return;
    mobileDrawerGestureRef.current = { x: touch.clientX, y: touch.clientY, pane: mobilePane };
    setMobileDrawerDragX(0);
  }
  function handleDrawerGestureMove(e: ReactTouchEvent<HTMLDivElement>) {
    const start = mobileDrawerGestureRef.current;
    const touch = e.touches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    // Detail -> Liste soll auch bei leicht vertikalem Fingerweg stabil reagieren.
    if (start.pane === "right") {
      if (deltaX <= 0) return;
      if (Math.abs(deltaY) > Math.abs(deltaX) * 1.35) return;
      if (Math.abs(deltaX) < 16) return;
    } else if (Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }
    e.preventDefault();
    setMobileDrawerDragX(deltaX);
  }
  function handleDrawerGestureEnd(e: ReactTouchEvent<HTMLDivElement>) {
    const start = mobileDrawerGestureRef.current;
    mobileDrawerGestureRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    if (!touch) {
      setMobileDrawerDragX(0);
      return;
    }
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    setMobileDrawerDragX(0);
    if (Math.abs(deltaY) > Math.abs(deltaX) && start.pane !== "right") return;
    if (Math.abs(deltaX) < (start.pane === "right" ? 34 : 54)) return;
    if (start.pane === "middle") {
      if (deltaX > 0) {
        openMobilePane("left");
      } else if (deltaX < 0 && rightDrawerEnabled) {
        openMobilePane("right");
      }
      return;
    }
    if (start.pane === "left" && deltaX < 0) {
      openMobilePane("middle");
      return;
    }
    if (start.pane === "right") {
      openMobilePane("middle");
    }
  }
  function clearMailSwipeFeedback(id: string) {
    const timeoutId = swipeFeedbackTimeoutsRef.current[id];
    if (typeof timeoutId === "number") {
      window.clearTimeout(timeoutId);
      delete swipeFeedbackTimeoutsRef.current[id];
    }
    setMailSwipeFeedback((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function showMailSwipeFeedback(id: string, action: MobileSwipeAction) {
    clearMailSwipeFeedback(id);
    setMailSwipeFeedback((prev) => ({ ...prev, [id]: action }));
    swipeFeedbackTimeoutsRef.current[id] = window.setTimeout(() => {
      setMailSwipeFeedback((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete swipeFeedbackTimeoutsRef.current[id];
    }, 1200);
  }
  function upsertEmailAtIndex(nextList: Email[], email: Email, index: number) {
    const without = nextList.filter((entry) => entry.id !== email.id);
    const safeIndex = clamp(index, 0, without.length);
    without.splice(safeIndex, 0, email);
    return without;
  }
  function removePendingSwipeTrashUndo(emailId: string) {
    setPendingSwipeTrashUndos((prev) => prev.filter((entry) => entry.email.id !== emailId));
  }
  function restoreSwipeTrashedEmail(entry: PendingSwipeTrashUndo) {
    removePendingSwipeTrashUndo(entry.email.id);
    const allMode = selectedAccountIdRef.current === "__all__";
    if (
      !allMode &&
      (selectedAccountIdRef.current !== entry.sourceAccountId ||
       selectedFolderPathRef.current !== entry.sourceFolderPath)
    ) {
      return;
    }
    setEmails((prev) => upsertEmailAtIndex(prev, entry.email, entry.originalIndex));
  }
  function scheduleSwipeTrashWithUndo(email: Email) {
    const originalIndex = emails.findIndex((entry) => entry.id === email.id);
    if (originalIndex < 0) return false;
    setUiError("");
    setUiInfo("");
    setEmails((prev) => prev.filter((entry) => entry.id !== email.id));
    if (selectedEmail?.id === email.id) {
      setSelectedEmail(null);
      openMobilePane("middle");
      setEmailDetailMenuOpen(false);
    }
    setPendingSwipeTrashUndos((prev) => {
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
          setUiError(await readErrorMessage(res, "Swipe-Löschen fehlgeschlagen."));
          const restoreEntry =
            pendingSwipeTrashUndosRef.current.find((item) => item.email.id === email.id) ?? null;
          removePendingSwipeTrashUndo(email.id);
          if (
            restoreEntry &&
            (selectedAccountIdRef.current === "__all__" ||
             (selectedAccountIdRef.current === restoreEntry.sourceAccountId &&
              selectedFolderPathRef.current === restoreEntry.sourceFolderPath))
          ) {
            setEmails((current) =>
              upsertEmailAtIndex(current, restoreEntry.email, restoreEntry.originalIndex),
            );
          }
          return;
        }
        removePendingSwipeTrashUndo(email.id);
        await reloadFolders();
      })();
    }, 5000);
    swipeTrashUndoSeqRef.current += 1;
    const undoEntry: PendingSwipeTrashUndo = {
      id: `swipe-trash-${email.id}-${swipeTrashUndoSeqRef.current}`,
      email,
      originalIndex,
      sourceAccountId: selectedAccountId,
      sourceFolderPath: selectedFolderPath,
      timeoutId,
    };
    setPendingSwipeTrashUndos((prev) => [...prev, undoEntry]);
    return true;
  }
  async function executeSwipeAction(email: Email, action: MobileSwipeAction) {
    if (action === "none") return false;
    if (action === "trash") {
      return scheduleSwipeTrashWithUndo(email);
    }
    if (action === "mark_read") {
      await runActionForEmail(email.id, `/api/emails/${email.id}/mark-read`);
      return true;
    }
    if (action === "mark_unread") {
      await runActionForEmail(email.id, `/api/emails/${email.id}/mark-unread`);
      return true;
    }
    if (action === "print") {
      window.open(`/api/emails/${email.id}/print?mode=${printMode}`, "_blank");
      setUiInfo("Druckansicht geöffnet.");
      return true;
    }
    return false;
  }
  function handleMailRowSwipeStart(emailId: string, e: ReactTouchEvent<HTMLDivElement>) {
    const touch = e.touches[0];
    if (!touch) return;
    mailRowSwipeStartRef.current = { id: emailId, x: touch.clientX, y: touch.clientY };
    setMailSwipeOffsets((prev) => (prev[emailId] ? { ...prev, [emailId]: 0 } : prev));
  }
  function handleMailRowSwipeMove(emailId: string, e: ReactTouchEvent<HTMLDivElement>) {
    const state = mailRowSwipeStartRef.current;
    const touch = e.touches[0];
    if (!state || state.id !== emailId || !touch) return;
    const deltaX = touch.clientX - state.x;
    const deltaY = touch.clientY - state.y;
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    e.preventDefault();
    setMailSwipeOffsets((prev) => ({ ...prev, [emailId]: clamp(deltaX, -112, 112) }));
  }
  async function handleMailRowSwipeEnd(email: Email, e: ReactTouchEvent<HTMLDivElement>) {
    const state = mailRowSwipeStartRef.current;
    mailRowSwipeStartRef.current = null;
    const touch = e.changedTouches[0];
    const deltaX = touch ? touch.clientX - (state?.x ?? touch.clientX) : 0;
    setMailSwipeOffsets((prev) => {
      if (!prev[email.id]) return prev;
      const next = { ...prev };
      delete next[email.id];
      return next;
    });
    if (!state || state.id !== email.id || Math.abs(deltaX) < 70) return;
    const direction = deltaX < 0 ? "left" : "right";
    const action = getSwipeActionForDirection(direction);
    const executed = await executeSwipeAction(email, action);
    if (executed) {
      showMailSwipeFeedback(email.id, action);
    }
  }
  function handleFolderDragOver(e: React.DragEvent, path: string) {
    e.preventDefault();
    if (dragOverFolderPath !== path) {
      if (dragExpandTimeoutRef.current) clearTimeout(dragExpandTimeoutRef.current);
      setDragOverFolderPath(path);
      dragExpandTimeoutRef.current = setTimeout(() => {
        setExpandedFolderPaths((prev) => {
          if (prev.has(path)) return prev;
          const next = new Set(prev);
          next.add(path);
          return next;
        });
      }, 800);
    }
  }
  function handleFolderDragLeave() {
    if (dragExpandTimeoutRef.current) {
      clearTimeout(dragExpandTimeoutRef.current);
      dragExpandTimeoutRef.current = null;
    }
    setDragOverFolderPath(null);
  }
  function handleFolderDrop(e: React.DragEvent, targetPath: string) {
    e.preventDefault();
    if (dragExpandTimeoutRef.current) {
      clearTimeout(dragExpandTimeoutRef.current);
      dragExpandTimeoutRef.current = null;
    }
    setDragOverFolderPath(null);
    const idsRaw = e.dataTransfer.getData("text/x-mailpilot-email-ids");
    const emailId = e.dataTransfer.getData("text/x-mailpilot-email-id");
    let ids: string[] = [];
    try {
      ids = idsRaw ? (JSON.parse(idsRaw) as string[]) : [];
    } catch { /* ignore */ }
    if (ids.length === 0 && emailId) ids = [emailId];
    if (ids.length === 0) return;

    if (ids.length > 1) {
      void runBulk("move_folder", { targetFolder: targetPath }, ids);
    } else {
      const singleId = ids[0];
      const droppedEmail = emails.find((em) => em.id === singleId);
      void runActionForEmail(singleId, `/api/emails/${singleId}/move`, { targetFolder: targetPath });
      if (droppedEmail?.fromEmail) {
        void checkSenderProfileAfterMove(
          droppedEmail.fromEmail,
          droppedEmail.fromName ?? "",
          targetPath,
          singleId,
        );
      }
    }
  }

  async function checkSenderProfileAfterMove(
    fromEmail: string,
    fromName: string,
    targetFolder: string,
    emailId: string,
  ) {
    try {
      const res = await fetch("/api/sender-profiles/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fromEmail }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.profile) return;
      if (senderProfileToastTimerRef.current) {
        clearTimeout(senderProfileToastTimerRef.current);
      }
      setSenderProfileToast({ fromEmail, fromName, targetFolder, emailId });
      senderProfileToastTimerRef.current = setTimeout(() => {
        setSenderProfileToast(null);
        senderProfileToastTimerRef.current = null;
      }, 8000);
    } catch {
      /* ignore */
    }
  }

  async function handleRememberSenderProfile() {
    if (!senderProfileToast) return;
    const { fromEmail, fromName, targetFolder } = senderProfileToast;
    try {
      const suggestRes = await fetch("/api/sender-profiles/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fromEmail, fromName }),
      });
      const suggestion = suggestRes.ok ? await suggestRes.json() : null;

      const folderLower = targetFolder.toLowerCase();
      let cat = "Sonstiges";
      const catMap: Record<string, string> = {
        kunde: "Kunde", kunden: "Kunde", lieferant: "Lieferant", lieferanten: "Lieferant",
        subunternehmer: "Subunternehmer", sub: "Subunternehmer", privat: "Privat",
        werbung: "Werbung", newsletter: "Werbung",
      };
      for (const [kw, c] of Object.entries(catMap)) {
        if (folderLower.includes(kw)) { cat = c; break; }
      }

      await fetch("/api/sender-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: suggestion?.profileName ?? (fromName || fromEmail.split("@")[0]),
          patterns: suggestion?.patterns ?? [fromEmail.split("@")[1] ?? fromEmail],
          category: cat,
          targetFolder,
        }),
      });

      setUiInfo(`Absender-Profil für ${suggestion?.profileName ?? fromEmail} erstellt.`);
    } catch {
      setUiError("Absender-Profil konnte nicht erstellt werden.");
    }
    if (senderProfileToastTimerRef.current) {
      clearTimeout(senderProfileToastTimerRef.current);
      senderProfileToastTimerRef.current = null;
    }
    setSenderProfileToast(null);
  }

  // --- Label system helpers ---

  async function loadLabels() {
    try {
      const res = await fetch("/api/labels");
      if (!res.ok) return;
      const data = await res.json();
      setLabelList(data.labels ?? []);
    } catch { /* ignore */ }
  }

  async function addLabelToEmail(emailId: string, label: string) {
    try {
      const res = await fetch(`/api/emails/${emailId}/labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newLabels: string[] = data.labels ?? [];
      setSelectedEmail((prev) =>
        prev?.id === emailId ? { ...prev, labels: newLabels } : prev,
      );
      setEmails((prev) =>
        prev.map((e) => (e.id === emailId ? { ...e, labels: newLabels } : e)),
      );
      void loadLabels();
    } catch { /* ignore */ }
  }

  async function removeLabelFromEmail(emailId: string, label: string) {
    try {
      const res = await fetch(`/api/emails/${emailId}/labels`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newLabels: string[] = data.labels ?? [];
      setSelectedEmail((prev) =>
        prev?.id === emailId ? { ...prev, labels: newLabels } : prev,
      );
      setEmails((prev) =>
        prev.map((e) => (e.id === emailId ? { ...e, labels: newLabels } : e)),
      );
      void loadLabels();
    } catch { /* ignore */ }
  }

  async function createAndAddLabel(emailId: string, labelName: string) {
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: labelName, color: "#3b82f6" }),
      });
      if (!res.ok) return;
      await addLabelToEmail(emailId, labelName);
    } catch { /* ignore */ }
  }

  async function loadEmailsByLabel(label: string) {
    setSelectedLabel(label);
    setSelectedEmail(null);
    setIsLoadingEmails(true);
    try {
      const res = await fetch(`/api/emails/by-label?label=${encodeURIComponent(label)}&limit=${mailScrollBatchSize}`);
      if (!res.ok) {
        setUiError("E-Mails für Label konnten nicht geladen werden.");
        setEmails([]);
        return;
      }
      const data = await res.json();
      setEmails(data.emails ?? []);
      const pageInfo = data.pageInfo;
      emailsNextCursorRef.current = pageInfo?.nextCursor ?? null;
      emailsHasMoreRef.current = pageInfo?.hasMore ?? false;
      setEmailsHasMore(pageInfo?.hasMore ?? false);
    } catch {
      setUiError("Label-Ansicht konnte nicht geladen werden.");
    } finally {
      setIsLoadingEmails(false);
    }
  }

  // --- Auto-Prompt (Feature 1) helpers ---

  async function checkSenderOnOpen(email: Email) {
    if (!email.fromEmail) return;
    if (checkedSenders.has(email.fromEmail)) return;
    checkedSenders.add(email.fromEmail);
    try {
      const res = await fetch(
        `/api/sender-profiles/check-sender?email=${encodeURIComponent(email.fromEmail)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.matched) return;
      const domain = email.fromEmail.split("@")[1] ?? "";
      setSenderPromptData({
        email: email.fromEmail,
        domain,
        fromName: email.fromName ?? "",
      });
      setSenderPromptCategory("Sonstiges");
      setSenderPromptFolder("");
      setSenderPromptVisible(true);
    } catch { /* ignore */ }
  }

  async function handleSenderPromptSave() {
    if (!senderPromptData) return;
    setSenderPromptSaving(true);
    try {
      const suggestRes = await fetch("/api/sender-profiles/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: senderPromptData.email, fromName: senderPromptData.fromName }),
      });
      const suggestion = suggestRes.ok ? await suggestRes.json() : null;

      const targetFolder = senderPromptFolder || "INBOX";
      await fetch("/api/sender-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: suggestion?.profileName ?? (senderPromptData.fromName || senderPromptData.email.split("@")[0]),
          patterns: suggestion?.patterns ?? [senderPromptData.domain || senderPromptData.email],
          category: senderPromptCategory,
          targetFolder,
        }),
      });
      setUiInfo(`Absender-Profil für ${senderPromptData.domain || senderPromptData.email} erstellt.`);

      if (targetFolder && targetFolder !== "INBOX" && selectedEmail) {
        const domain = senderPromptData.domain;
        const emailMatch = selectedEmail.fromEmail &&
          (selectedEmail.fromEmail === senderPromptData.email ||
            (domain && selectedEmail.fromEmail.endsWith(`@${domain}`))) &&
          selectedEmail.folderPath === "INBOX";
        if (emailMatch) {
          const id = selectedEmail.id;
          setEmails((prev) => prev.filter((e) => e.id !== id));
          setSelectedEmail(null);
          void runActionForEmail(id, `/api/emails/${id}/move`, { targetFolder });
        }
      }
    } catch {
      setUiError("Absender-Profil konnte nicht erstellt werden.");
    } finally {
      setSenderPromptSaving(false);
      setSenderPromptVisible(false);
      setSenderPromptData(null);
    }
  }

  function handleSenderPromptSkip() {
    setSenderPromptVisible(false);
    setSenderPromptData(null);
  }

  async function handleSenderPromptIgnore() {
    if (!senderPromptData) return;
    setSenderPromptSaving(true);
    try {
      await fetch("/api/sender-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: senderPromptData.domain || senderPromptData.email,
          patterns: [senderPromptData.domain || senderPromptData.email],
          category: "ignore",
          targetFolder: "",
        }),
      });
    } catch { /* ignore */ }
    setSenderPromptSaving(false);
    setSenderPromptVisible(false);
    setSenderPromptData(null);
  }

  function toggleSelected(id: string, shiftKey?: boolean) {
    const isShift = shiftKey ?? shiftHeldRef.current;
    if (isShift && lastSelectedIdRef.current && lastSelectedIdRef.current !== id) {
      const lastIdx = emails.findIndex((e) => e.id === lastSelectedIdRef.current);
      const curIdx = emails.findIndex((e) => e.id === id);
      if (lastIdx !== -1 && curIdx !== -1) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(emails[i].id);
          return next;
        });
        lastSelectedIdRef.current = id;
        return;
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedIdRef.current = id;
  }
  function toggleSelectAllVisible() {
    if (emails.length === 0) return;
    const allSelected = emails.every((e) => selectedIds.has(e.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(emails.map((e) => e.id)));
    }
  }

  function closeMailContextMenu() {
    setMailContextMenu(null);
  }

  function openMailContextMenu(e: ReactMouseEvent, email: Email) {
    e.preventDefault();
    e.stopPropagation();
    const useCurrentSelection = selectedIds.size > 1 && selectedIds.has(email.id);
    const targetIds = useCurrentSelection ? Array.from(selectedIds) : [email.id];
    if (!useCurrentSelection) {
      setSelectedIds(new Set([email.id]));
    }
    setMailContextMenu({
      x: e.clientX,
      y: e.clientY,
      emailId: email.id,
      targetIds,
    });
    setContextMoveTargetFolder(moveTargetFolder || folders[0]?.path || "");
    setContextAttachmentId(email.attachments?.[0]?.id ?? "");
  }

  function toggleFolderExpanded(path: string) {
    setExpandedFolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function isUnread(email: Email) {
    return !(email.flags ?? []).includes("\\Seen");
  }

  function getAttachmentTarget(attachmentId: string) {
    return (
      attachmentTargets[attachmentId] ?? {
        provider: "mock" as const,
        targetPath: "/Rechnungen/{{year}}/{{month}}/{{senderDomain}}/",
      }
    );
  }

  function updateAttachmentTarget(
    attachmentId: string,
    patch: Partial<{ provider: "google_drive" | "onedrive" | "mock"; targetPath: string }>,
  ) {
    setAttachmentTargets((prev) => ({
      ...prev,
      [attachmentId]: {
        ...getAttachmentTarget(attachmentId),
        ...patch,
      },
    }));
  }

  async function readErrorMessage(res: Response, fallback: string) {
    try {
      const data = (await res.json()) as { error?: string };
      if (typeof data.error === "string" && data.error.trim()) return data.error;
    } catch {
      // ignore
    }
    return fallback;
  }

  async function loadAccounts() {
    const res = await fetch("/api/accounts");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Konten konnten nicht geladen werden."));
      return;
    }
    const data = await res.json();
    const next: Account[] = data.accounts ?? [];
    setAccounts(next);
    if (!next.length) {
      setSelectedAccountId("");
      setSelectedFolderPath("");
      setMoveTargetFolder("");
      setFolders([]);
      setEmails([]);
      setSelectedEmail(null);
      return;
    }
    if (!next.some((a) => a.id === selectedAccountId)) {
      const defaultAccount = next.find((a) => a.isDefault);
      setSelectedAccountId(defaultAccount ? defaultAccount.id : next[0].id);
    }
  }

  async function loadFolders(accountId: string) {
    if (!accountId) return;
    const res = await fetch(`/api/accounts/${accountId}/folders`);
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Ordner konnten nicht geladen werden."));
      setFolders([]);
      return;
    }
    const data = await res.json();
    const next: Folder[] = data.folders ?? [];
    setFolders(next);
    if (!next.length) {
      setSelectedFolderPath("");
    } else if (!next.some((f) => f.path === selectedFolderPathRef.current)) {
      setSelectedFolderPath(next[0].path);
    }
    setMoveTargetFolder(next[0]?.path ?? "");
  }

  async function loadContactCandidates() {
    const res = await fetch("/api/contact-candidates");
    if (!res.ok) return;
    const data = await res.json();
    setContactCandidates(data.candidates ?? []);
  }

  async function loadSignatureSettings() {
    const res = await fetch("/api/signatures");
    if (!res.ok) return;
    const data = (await res.json()) as { signatures?: SignatureData[] };
    if (data.signatures) setSignatures(data.signatures);
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
    if (typeof runOnStart === "boolean") {
      setRunOnAppStart(runOnStart);
    }
    const interval = data.settings?.runIntervalMinutes;
    if (typeof interval === "number" && Number.isFinite(interval) && interval >= 5) {
      setNewMailCheckIntervalMinutes(interval);
    }
    const batch = data.settings?.mailScrollBatchSize;
    if (typeof batch === "number" && Number.isFinite(batch)) {
      setMailScrollBatchSize(snapMailScrollBatchSize(batch));
    }
  }

  async function loadAutomationRuns() {
    const res = await fetch("/api/automation/runs");
    if (!res.ok) return;
    const data = (await res.json()) as { runs?: AutomationRunSummary[] };
    const nextRuns = (data.runs ?? []).slice(0, 5);
    setAutomationRuns(nextRuns);
  }

  async function saveAutomationDashboardSettings(patch: {
    runOnAppStart?: boolean;
    runIntervalMinutes?: number;
  }) {
    setAutomationSaving(true);
    try {
      const res = await fetch("/api/automation/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setUiError(await readErrorMessage(res, "Auto-Update-Einstellungen konnten nicht gespeichert werden."));
        return false;
      }
      const data = (await res.json()) as {
        settings?: { runOnAppStart?: boolean; runIntervalMinutes?: number };
      };
      if (typeof data.settings?.runOnAppStart === "boolean") {
        setRunOnAppStart(data.settings.runOnAppStart);
      }
      if (
        typeof data.settings?.runIntervalMinutes === "number" &&
        Number.isFinite(data.settings.runIntervalMinutes)
      ) {
        setNewMailCheckIntervalMinutes(Math.max(5, Math.round(data.settings.runIntervalMinutes)));
      }
      setUiInfo("Auto-Update-Einstellungen gespeichert.");
      return true;
    } finally {
      setAutomationSaving(false);
    }
  }

  async function runAutomationNow() {
    if (!selectedAccountId || isAllAccounts) return;
    setAutomationRunningNow(true);
    try {
      const res = await fetch("/api/automation/run-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "full", accountId: selectedAccountId }),
      });
      if (!res.ok) {
        setUiError(await readErrorMessage(res, "Auto-Update konnte nicht gestartet werden."));
        return;
      }
      setUiInfo("Auto-Update wurde gestartet.");
      await Promise.all([loadAutomationRuns(), loadEmails(), reloadFolders()]);
    } finally {
      setAutomationRunningNow(false);
    }
  }

  async function manageFolder(
    action: "create" | "delete" | "rename" | "copy",
    payload:
      | { path: string }
      | { fromPath: string; toPath: string },
  ) {
    if (!selectedAccountId || isAllAccounts) {
      setUiError("Bitte zuerst ein spezifisches Konto wählen.");
      return;
    }
    setIsManagingFolder(true);
    setUiError("");
    setUiInfo("");
    try {
      const res = await fetch(`/api/accounts/${selectedAccountId}/folders/manage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        setUiError(await readErrorMessage(res, "Ordner-Aktion fehlgeschlagen."));
        return;
      }
      const data = (await res.json()) as { folders?: Folder[] };
      const nextFolders = data.folders ?? [];
      setFolders(nextFolders);
      if (action === "delete" && "path" in payload && selectedFolderPath === payload.path) {
        setSelectedFolderPath(nextFolders[0]?.path ?? "");
        setSelectedEmail(null);
        setBodyContent(null);
        setMobilePane("middle");
      } else if ((action === "rename" || action === "copy") && "toPath" in payload) {
        setSelectedFolderPath(payload.toPath);
      } else if (action === "create" && "path" in payload) {
        setSelectedFolderPath(payload.path);
      }
      await loadEmails();
      const labels: Record<typeof action, string> = {
        create: "Ordner angelegt",
        delete: "Ordner gelöscht",
        rename: "Ordner umbenannt",
        copy: "Ordner kopiert",
      };
      setUiInfo(labels[action]);
    } finally {
      setIsManagingFolder(false);
    }
  }

  function createFolderPrompt() {
    const prefix = selectedFolderPath ? `${selectedFolderPath}/` : "";
    const hint = selectedFolderPath
      ? `Unterordner von "${folderDisplayName(selectedFolderPath)}" erstellen.\nOrdnername:`
      : "Neuen Ordnernamen eingeben (z. B. Kunden/Neukunden):";
    const input = window.prompt(hint);
    const name = input?.trim();
    if (!name) return;
    const path = prefix + name;
    void manageFolder("create", { path });
  }

  function renameFolderPrompt() {
    if (!selectedFolderPath) return;
    const next = window.prompt(
      `Neuen Namen/Pfad für "${selectedFolderPath}" eingeben:`,
      selectedFolderPath,
    );
    const toPath = next?.trim();
    if (!toPath || toPath === selectedFolderPath) return;
    void manageFolder("rename", { fromPath: selectedFolderPath, toPath });
  }

  function copyFolderPrompt() {
    if (!selectedFolderPath) return;
    const defaultTarget = `${selectedFolderPath}_copy`;
    const next = window.prompt(
      `Zielordner für Kopie von "${selectedFolderPath}" eingeben:`,
      defaultTarget,
    );
    const toPath = next?.trim();
    if (!toPath || toPath === selectedFolderPath) return;
    void manageFolder("copy", { fromPath: selectedFolderPath, toPath });
  }

  function deleteFolderPrompt() {
    if (!selectedFolderPath) return;
    const isGmail = selectedAccount?.imapHost?.includes("gmail.com") || selectedAccount?.imapHost?.includes("google.com");
    const warning = isGmail
      ? `Ordner "${selectedFolderPath}" löschen?\n\n⚠️ Gmail: Das Label wird entfernt, aber die E-Mails bleiben erhalten (unter "Alle Nachrichten" auffindbar).`
      : `Ordner "${selectedFolderPath}" wirklich löschen?\n\n⚠️ ACHTUNG: Bei diesem Provider (${selectedAccount?.imapHost ?? "IMAP"}) werden die E-Mails im Ordner möglicherweise unwiderruflich gelöscht!`;
    if (!window.confirm(warning)) {
      return;
    }
    void manageFolder("delete", { path: selectedFolderPath });
  }

  function handleFolderMoveByDrag(sourcePath: string, targetPath: string) {
    const folderName = sourcePath.split("/").pop() || sourcePath;
    const newPath = `${targetPath}/${folderName}`;
    if (
      !window.confirm(
        `Ordner "${folderName}" nach "${targetPath}" verschieben?\n\nNeuer Pfad: ${newPath}`,
      )
    ) {
      return;
    }
    void manageFolder("rename", { fromPath: sourcePath, toPath: newPath });
  }

  const isAllAccounts = selectedAccountId === "__all__";

  function mailListSearchParams(cursor: string | null) {
    const params = new URLSearchParams();
    if (selectedAccountId && !isAllAccounts) {
      params.set("accountId", selectedAccountIdRef.current || selectedAccountId);
      params.set("folder", selectedFolderPathRef.current || selectedFolderPath);
    }
    params.set("sort", sort);
    params.set("limit", String(mailScrollBatchSize));
    if (query.trim()) params.set("q", query.trim());
    if (hasAttachmentsFilter) params.set("hasAttachments", "true");
    if (actionRequiredFilter) params.set("actionRequired", "true");
    if (localFlagFilter !== "all") params.set("localFlag", localFlagFilter);
    if (tab === "unread") params.set("isRead", "false");
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function loadMoreEmails() {
    const cursor = emailsNextCursorRef.current;
    if (
      !emailsHasMoreRef.current ||
      !cursor ||
      loadMoreInFlightRef.current ||
      isLoadingEmailsRef.current
    ) {
      return;
    }
    if (!selectedAccountId || (!isAllAccounts && !selectedFolderPath)) return;
    loadMoreInFlightRef.current = true;
    setIsLoadingMoreEmails(true);
    setUiError("");
    try {
      const res = await fetch(`/api/search?${mailListSearchParams(cursor).toString()}`);
      if (!res.ok) {
        setUiError(await readErrorMessage(res, "Weitere E-Mails konnten nicht geladen werden."));
        return;
      }
      const data = (await res.json()) as {
        emails?: Email[];
        pageInfo?: { nextCursor?: string | null; hasMore?: boolean };
      };
      const more = data.emails ?? [];
      const pageInfo = data.pageInfo;
      setEmails((prev) => {
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
      const nextC = pageInfo?.nextCursor ?? null;
      const morePages = pageInfo?.hasMore ?? false;
      emailsNextCursorRef.current = nextC;
      emailsHasMoreRef.current = morePages;
      setEmailsHasMore(morePages);
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMoreEmails(false);
    }
  }

  useEffect(() => {
    loadMoreEmailsRef.current = loadMoreEmails;
  });

  useEffect(() => {
    pendingSwipeTrashUndosRef.current = pendingSwipeTrashUndos;
  }, [pendingSwipeTrashUndos]);
  useEffect(() => {
    selectedAccountIdRef.current = selectedAccountId;
  }, [selectedAccountId]);
  useEffect(() => {
    selectedFolderPathRef.current = selectedFolderPath;
  }, [selectedFolderPath]);

  async function loadEmails() {
    const requestId = ++activeLoadEmailsRequestIdRef.current;
    if (!selectedAccountId || (!isAllAccounts && !selectedFolderPath)) {
      if (requestId === activeLoadEmailsRequestIdRef.current) {
        setEmails([]);
        setSelectedEmail(null);
        emailsNextCursorRef.current = null;
        emailsHasMoreRef.current = false;
        setEmailsHasMore(false);
      }
      return [] as Email[];
    }
    isLoadingEmailsRef.current = true;
    if (requestId === activeLoadEmailsRequestIdRef.current) {
      setIsLoadingEmails(true);
      setUiError("");
      emailsNextCursorRef.current = null;
      emailsHasMoreRef.current = false;
      setEmailsHasMore(false);
    }

    const res = await fetch(`/api/search?${mailListSearchParams(null).toString()}`);
    if (requestId !== activeLoadEmailsRequestIdRef.current) {
      return [] as Email[];
    }
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "E-Mails konnten nicht geladen werden."));
      setEmails([]);
      setSelectedEmail(null);
      isLoadingEmailsRef.current = false;
      setIsLoadingEmails(false);
      return [] as Email[];
    }

    const data = (await res.json()) as {
      emails?: Email[];
      pageInfo?: { nextCursor?: string | null; hasMore?: boolean };
    };
    if (requestId !== activeLoadEmailsRequestIdRef.current) {
      return [] as Email[];
    }
    const nextEmails: Email[] = data.emails ?? [];
    const pageInfo = data.pageInfo;
    const nextC = pageInfo?.nextCursor ?? null;
    const more = pageInfo?.hasMore ?? false;
    emailsNextCursorRef.current = nextC;
    emailsHasMoreRef.current = more;
    setEmailsHasMore(more);
    setEmails(nextEmails);
    if (!nextEmails.length) {
      setSelectedEmail(null);
    } else if (selectedEmail && !nextEmails.some((e) => e.id === selectedEmail.id)) {
      setSelectedEmail(null);
      setMobilePane("middle");
      setEmailDetailMenuOpen(false);
    }
    isLoadingEmailsRef.current = false;
    setIsLoadingEmails(false);
    return nextEmails;
  }

  async function loadEmail(id: string) {
    if (pendingAutoMoveRef.current && pendingAutoMoveRef.current.emailId !== id) {
      const { emailId: moveId, folder } = pendingAutoMoveRef.current;
      pendingAutoMoveRef.current = null;
      setEmails((prev) => prev.filter((e) => e.id !== moveId));
      if (autoMoveToastTimerRef.current) clearTimeout(autoMoveToastTimerRef.current);
      setAutoMoveToast({ emailId: moveId, folder });
      autoMoveToastTimerRef.current = setTimeout(() => {
        setAutoMoveToast(null);
        autoMoveToastTimerRef.current = null;
      }, 5000);
      void reloadFolders();
    }
    const requestId = ++activeLoadEmailRequestIdRef.current;
    setIsLoadingDetail(true);
    setEmailDetailMenuOpen(false);
    setAttachmentPreviewOpen(new Set());
    setBodyContent(null);
    setBodyError("");
    setBodyMode("html");
    setIsBodyMaximized(false);
    setShowExternalImages(false);
    setIsLoadingBody(true);
    const res = await fetch(`/api/emails/${id}`);
    if (requestId !== activeLoadEmailRequestIdRef.current) {
      return;
    }
    if (!res.ok) {
      setUiError("E-Mail konnte nicht geladen werden.");
      setSelectedEmail(null);
      setEmailDetailMenuOpen(false);
      setIsLoadingDetail(false);
      setIsLoadingBody(false);
      return;
    }
    const data = await res.json();
    if (requestId !== activeLoadEmailRequestIdRef.current) {
      return;
    }
    const emailData = data.email ?? null;
    setSelectedEmail(emailData);
    setMobilePane("right");
    setIsLoadingDetail(false);
    loadContactCandidates().catch(() => {});
    await loadBody(id);
    if (requestId !== activeLoadEmailRequestIdRef.current) {
      return;
    }
    if (emailData) {
      const isUnread = !(emailData.flags ?? []).includes("\\Seen");
      const isInInbox = emailData.folderPath === "INBOX";
      if (isUnread || isInInbox) {
        fetch(`/api/emails/${id}/mark-read`, { method: "POST" })
          .then(async (res) => {
            if (!res.ok) return;
            const mrData = await res.json().catch(() => ({}));
            if (mrData.movedTo) {
              pendingAutoMoveRef.current = { emailId: id, folder: mrData.movedTo };
            }
          })
          .catch(() => {});
      }
      if (isUnread) {
        setSelectedEmail((prev: Email | null) =>
          prev?.id === id ? { ...prev, flags: [...(prev.flags ?? []), "\\Seen"] } : prev,
        );
        setEmails((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, flags: [...(e.flags ?? []), "\\Seen"] } : e,
          ),
        );
      }
    }
    if (emailData) {
      void checkSenderOnOpen(emailData);
    }
  }


  async function loadBody(id: string, force?: boolean) {
    setIsLoadingBody(true);
    setBodyError("");
    setShowExternalImages(false);
    try {
      const url = `/api/emails/${id}/body${force ? "?refresh=1" : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBodyError(
          (data as { error?: string }).error ?? "Mailinhalt konnte nicht geladen werden.",
        );
        setBodyContent(null);
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

      if (activeLoadEmailRequestIdRef.current > 0) {
        setBodyContent({ text, html });
        setBodyMode(html ? "html" : text ? "text" : "text");
      }
    } catch (error) {
      setBodyError(error instanceof Error ? error.message : "Mailinhalt konnte nicht geladen werden.");
      setBodyContent(null);
    } finally {
      setIsLoadingBody(false);
    }
  }

  async function reloadFolders() {
    if (selectedAccountId && !isAllAccounts) await loadFolders(selectedAccountId);
  }

  async function syncAllFolders(trigger: "manual" | "auto" = "manual") {
    if (!selectedAccountId || isAllAccounts) return;
    const accountId = selectedAccountId;
    if (
      trigger === "manual" &&
      !window.confirm(
        "Alle Ordner und Unterordner werden inkrementell synchronisiert (nur Header). Bei vielen Ordnern kann das dauern. Fortfahren?",
      )
    ) {
      return;
    }
    try {
      setIsSyncing(true);
      setSyncProgress({
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
      setUiInfo("");
      setUiError("");
      if (typeof window !== "undefined" && syncAllProgressPollRef.current !== null) {
        window.clearInterval(syncAllProgressPollRef.current);
        syncAllProgressPollRef.current = null;
      }
      if (typeof window !== "undefined") {
        syncAllProgressPollRef.current = window.setInterval(() => {
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
              setSyncProgress((prev) => {
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
              // ignore polling hiccups while sync is running
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
        setUiError(await readErrorMessage(res, fallback));
        return;
      }
      const data = (await res.json()) as {
        folderCount: number;
        totalNew: number;
        totalFlagsUpdated: number;
        totalRemoved: number;
        perFolder?: Array<{ skipped?: "busy" | "error" }>;
      };
      const skipped =
        data.perFolder?.filter((p) => p.skipped).length ?? 0;
      if (trigger === "manual") {
        setUiInfo(
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
      if (typeof window !== "undefined" && syncAllProgressPollRef.current !== null) {
        window.clearInterval(syncAllProgressPollRef.current);
        syncAllProgressPollRef.current = null;
      }
      setSyncProgress(null);
      setIsSyncing(false);
    }
  }

  async function checkNow() {
    if (!selectedAccountId || isAllAccounts) return;
    setIsSyncing(true);
    setSyncProgress({
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
      const res = await fetch(`/api/accounts/${selectedAccountId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: "INBOX", mode: "incremental" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUiError((data as { error?: string }).error ?? "Inbox-Check fehlgeschlagen.");
      } else {
        setUiInfo("Inbox-Check abgeschlossen.");
        if (selectedFolderPathRef.current === "INBOX") {
          await loadEmails();
        }
        await reloadFolders();
      }
    } catch (e) {
      setUiError(e instanceof Error ? e.message : "Inbox-Check fehlgeschlagen.");
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  }

  async function runBulk(
    action: "mark_read" | "mark_unread" | "move_trash" | "move_spam" | "move_folder",
    options?: { targetFolder?: string },
    explicitIds?: string[],
  ) {
    const ids = explicitIds?.length ? explicitIds : Array.from(selectedIds);
    if (ids.length === 0) return;
    if (action === "move_folder" && !options?.targetFolder) return;
    setBulkBusy(true);
    setUiInfo("");
    setUiError("");
    try {
      const res = await fetch("/api/emails/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          emailIds: ids,
          targetFolder: options?.targetFolder,
        }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        setUiError(
          (data as { error?: string }).error ??
            `Bulk-Aktion fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      const summary = (data as {
        summary?: { requested: number; executed: number; failed: number; rejected: number };
      }).summary;
      if (summary) {
        const parts = [
          `${summary.executed} verarbeitet`,
          summary.failed > 0 ? `${summary.failed} fehlgeschlagen` : "",
          summary.rejected > 0 ? `${summary.rejected} abgelehnt` : "",
        ].filter(Boolean);
        setUiInfo(`Bulk-Aktion: ${parts.join(", ")}.`);
      }
      clearSelection();
      await loadEmails();
      await reloadFolders();
    } finally {
      setBulkBusy(false);
    }
  }

  async function emptyCurrentFolder() {
    if (!selectedAccountId || isAllAccounts || !selectedFolderPath || !folderEmptyKind) return;
    if (emptyConfirmText !== "LEEREN") return;
    setBulkBusy(true);
    setUiInfo("");
    setUiError("");
    try {
      const res = await fetch("/api/folders/empty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccountId,
          folderPath: selectedFolderPath,
          confirm: true,
        }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        setUiError(
          (data as { error?: string }).error ??
            `Leeren fehlgeschlagen (HTTP ${res.status}).`,
        );
        return;
      }
      const deleted = (data as { deleted?: number }).deleted ?? 0;
      setUiInfo(
        `${folderEmptyKind === "trash" ? "Papierkorb" : "Spam"} geleert: ${deleted} E-Mails endgültig entfernt.`,
      );
      setEmptyFolderModalOpen(false);
      setEmptyConfirmText("");
      clearSelection();
      await loadEmails();
      await reloadFolders();
    } finally {
      setBulkBusy(false);
    }
  }

  async function runActionForEmail(emailId: string, path: string, payload?: object) {
    const prevEmails = emails;
    const wasSelected = selectedEmail?.id === emailId;
    setEmails((prev) => prev.filter((e) => e.id !== emailId));
    if (wasSelected) {
      setSelectedEmail(null);
      setMobilePane("middle");
      setEmailDetailMenuOpen(false);
    }

    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      setEmails(prevEmails);
      setUiError(await readErrorMessage(res, "Aktion fehlgeschlagen."));
      return;
    }
    void loadEmails();
    void reloadFolders();
  }

  async function runAction(path: string, payload?: object) {
    if (!selectedEmail) return;
    await runActionForEmail(selectedEmail.id, path, payload);
  }

  async function setLocalFlag(emailId: string, flag: "red" | "yellow" | "green" | null) {
    setUiError("");
    const res = await fetch(`/api/emails/${emailId}/local-flag`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flag }),
    });
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Lokaler Flag konnte nicht gespeichert werden."));
      return;
    }
    setEmails((prev) => prev.map((email) => (email.id === emailId ? { ...email, localFlag: flag } : email)));
    setSelectedEmail((prev) => (prev?.id === emailId ? { ...prev, localFlag: flag } : prev));
  }

  async function moveToSelectedFolder() {
    if (!selectedEmail || !moveTargetFolder) return;
    await runAction(`/api/emails/${selectedEmail.id}/move`, { targetFolder: moveTargetFolder });
    setMobileMovePanelOpen(false);
  }

  async function createMobileMoveFolder() {
    if (!selectedAccountId || isAllAccounts) {
      setUiError("Bitte zuerst ein spezifisches Konto wählen.");
      return;
    }
    const name = mobileNewFolderName.trim();
    if (!name) {
      setUiError("Bitte einen Ordnernamen eingeben.");
      return;
    }
    const parent = mobileNewFolderParentPath.trim();
    const nextPath = parent ? `${parent}/${name}` : name;
    await manageFolder("create", { path: nextPath });
    setMoveTargetFolder(nextPath);
    setMobileNewFolderName("");
    setMobileMovePanelOpen(true);
  }

  async function blockSender() {
    if (!selectedEmail?.fromEmail) return;
    const res = await fetch("/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: selectedEmail.fromEmail,
        action: "move_spam",
      }),
    });
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Absender konnte nicht blockiert werden."));
    }
  }

  async function blockDomain() {
    const sender = selectedEmail?.fromEmail;
    if (!sender || !sender.includes("@")) return;
    const domain = sender.split("@")[1]?.toLowerCase();
    if (!domain) return;
    if (!window.confirm(`Wirklich alle Mails von ${domain} blockieren?`)) return;
    const res = await fetch("/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain, action: "move_spam" }),
    });
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Domain konnte nicht blockiert werden."));
    }
  }

  function buildSpamContentFingerprint(email: Email) {
    const source = (email.subject ?? email.textPreview ?? email.snippet ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!source) return "";
    const withoutPrefixes = source.replace(/^((re|aw|fwd|wg)\s*:\s*)+/i, "").trim();
    const normalized = withoutPrefixes
      .replace(/[^a-zA-Z0-9@._\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length < 8) return "";
    return normalized.slice(0, 80);
  }

  async function markAsSpamAndLearn(email: Email) {
    setUiError("");
    const sender = email.fromEmail?.toLowerCase().trim() ?? "";
    const fingerprint = buildSpamContentFingerprint(email);

    await runActionForEmail(email.id, `/api/emails/${email.id}/move`, {
      targetSpecial: "spam",
    });

    const actionsDone: string[] = ["Mail in Spam verschoben"];
    if (sender) {
      const blockRes = await fetch("/api/blocklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: sender,
          action: "move_spam",
          note: "Per Kontextmenue als Spam-Absender gelernt",
        }),
      });
      if (blockRes.ok) {
        actionsDone.push("Absender fuer kuenftige Mails blockiert");
      } else {
        setUiError(await readErrorMessage(blockRes, "Absender-Regel konnte nicht gespeichert werden."));
      }
    }

    if (fingerprint) {
      const ruleRes = await fetch("/api/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `Auto-Spam: ${fingerprint.slice(0, 40)}`,
          active: true,
          priority: 10,
          conditionJson: {
            any: [
              ...(sender
                ? [{ field: "fromEmail", operator: "equals", value: sender }]
                : []),
              { field: "subject", operator: "contains", value: fingerprint },
            ],
          },
          actionJson: {
            actions: [{ type: "move_spam" }],
            stopAfterMatch: true,
          },
        }),
      });
      if (ruleRes.ok) {
        actionsDone.push("Inhaltsregel fuer aehnliche Mails aktiviert");
      } else {
        setUiError(await readErrorMessage(ruleRes, "Inhalts-Regel konnte nicht gespeichert werden."));
      }
    }

    if (actionsDone.length > 0) {
      setUiInfo(`${actionsDone.join(" · ")}.`);
    }
  }

  async function createContactSuggestion() {
    if (!selectedEmail) return;
    await runAction(`/api/emails/${selectedEmail.id}/analyze`);
    await loadContactCandidates();
  }

  async function saveAttachmentToCloud(attachmentId: string) {
    if (!selectedEmail) return;
    const target = getAttachmentTarget(attachmentId);
    const res = await fetch(
      `/api/emails/${selectedEmail.id}/attachments/${attachmentId}/save`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      },
    );
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Anhang konnte nicht gespeichert werden."));
    }
    await loadEmail(selectedEmail.id);
  }

  async function saveAttachmentToCloudForEmail(emailId: string, attachmentId: string) {
    const target = getAttachmentTarget(attachmentId);
    const res = await fetch(`/api/emails/${emailId}/attachments/${attachmentId}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
    });
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Anhang konnte nicht gespeichert werden."));
      return;
    }
    if (selectedEmail?.id === emailId) {
      await loadEmail(emailId);
    }
  }

  function getSignatureFor(mode: "new" | "reply" | "forward", accountId?: string) {
    const matchByAccount = accountId
      ? signatures.find((s) => s.accountIds.includes(accountId))
      : undefined;
    const sig = matchByAccount ?? signatures.find((s) => s.isDefault) ?? null;
    if (!sig) return "";
    if (mode === "new" && !sig.includeOnNewMail) return "";
    if (mode === "reply" && !sig.includeOnReply) return "";
    if (mode === "forward" && !sig.includeOnForward) return "";
    return sig.htmlContent;
  }

  function insertSignatureHtml(mode: ComposeMode, accountId?: string) {
    const html = getSignatureFor(mode, accountId);
    if (!html) return "";
    return `<p><br/></p><div>${html}</div>`;
  }

  function openCompose(mode: ComposeMode, source?: Email) {
    const defaultAccountId = (isAllAccounts ? "" : selectedAccountId) || accounts[0]?.id || "";
    const quoteText =
      source && mode !== "new"
        ? buildMailtoQuote(
            source,
            mode === "reply" ? "--- Ursprüngliche Nachricht ---" : "--- Weitergeleitete Nachricht ---",
          )
        : "";
    const quoteHtml = quoteText ? `<p>${plainToHtml(quoteText)}</p>` : "";
    const signatureHtml = insertSignatureHtml(mode, source?.accountId || defaultAccountId);
    setComposeMode(mode);
    setComposeForm({
      draftId: null,
      accountId: source?.accountId || defaultAccountId,
      to: mode === "reply" ? source?.fromEmail ?? "" : "",
      cc: "",
      bcc: "",
      subject:
        mode === "reply"
          ? `Re: ${source?.subject ?? ""}`
          : mode === "forward"
            ? `Fwd: ${source?.subject ?? ""}`
            : "",
      bodyHtml: `<div dir="ltr" style="direction:ltr;text-align:left"><br></div>${signatureHtml}${quoteHtml}`.trim(),
      sendAtLocal: "",
    });
    setComposeOpen(true);
  }

  function composeNewMail() {
    openCompose("new");
  }

  function replyToSelected() {
    if (!selectedEmail) return;
    openCompose("reply", selectedEmail);
  }

  function forwardSelected() {
    if (!selectedEmail) return;
    openCompose("forward", selectedEmail);
  }

  function replyAllSelected() {
    if (!selectedEmail) return;
    const own = selectedAccount?.imapUsername?.toLowerCase().trim() ?? "";
    const sender = selectedEmail.fromEmail?.toLowerCase().trim() ?? "";
    const additionalCc = [...(selectedEmail.toEmails ?? []), ...(selectedEmail.ccEmails ?? [])]
      .map((mail) => mail.trim())
      .filter((mail) => {
        const lower = mail.toLowerCase();
        if (!lower) return false;
        if (own && lower === own) return false;
        if (sender && lower === sender) return false;
        return true;
      });
    openCompose("reply", selectedEmail);
    setComposeForm((prev) => ({
      ...prev,
      cc: Array.from(new Set(additionalCc)).join(", "),
    }));
  }

  function applyComposeCommand(command: string, value?: string) {
    if (!composeEditorRef.current) return;
    composeEditorRef.current.focus();
    document.execCommand(command, false, value);
    setComposeForm((prev) => ({
      ...prev,
      bodyHtml: composeEditorRef.current?.innerHTML || "",
    }));
  }

  async function submitCompose(action: "send_now" | "send_later" | "save_draft") {
    const bodyHtml = composeEditorRef.current?.innerHTML || composeForm.bodyHtml || "";
    const payload = {
      action,
      draftId: composeForm.draftId ?? undefined,
      accountId: composeForm.accountId,
      to: parseRecipientList(composeForm.to),
      cc: parseRecipientList(composeForm.cc),
      bcc: parseRecipientList(composeForm.bcc),
      subject: composeForm.subject,
      html: bodyHtml,
      text: stripHtml(bodyHtml),
      sendAt: action === "send_later" ? new Date(composeForm.sendAtLocal).toISOString() : undefined,
    };
    if (!payload.accountId) {
      setUiError("Bitte ein Konto für den Versand auswählen.");
      return;
    }
    if ((action === "send_now" || action === "send_later") && payload.to.length === 0) {
      setUiError("Bitte mindestens einen Empfänger in 'An' eintragen.");
      return;
    }
    if (action === "send_later" && !composeForm.sendAtLocal) {
      setUiError("Bitte einen Zeitpunkt für 'später senden' angeben.");
      return;
    }
    setComposeSaving(true);
    const res = await fetch("/api/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      info?: string;
      error?: string;
      draft?: { id?: string };
    };
    if (!res.ok) {
      setUiError(data.error ?? "Mail-Aktion fehlgeschlagen.");
      setComposeSaving(false);
      return;
    }
    if (data.draft?.id) {
      setComposeForm((prev) => ({ ...prev, draftId: data.draft?.id || prev.draftId }));
    }
    setUiInfo(data.info ?? "Aktion erfolgreich.");
    if (action !== "save_draft") {
      setComposeOpen(false);
    }
    setComposeSaving(false);
  }

  function openAttachment(emailId: string, attachmentId: string) {
    const previewUrl = `/api/emails/${emailId}/attachments/${attachmentId}/preview`;
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }

  function printAttachment(emailId: string, attachmentId: string) {
    const previewUrl = `/api/emails/${emailId}/attachments/${attachmentId}/preview`;
    const w = window.open(previewUrl, "_blank");
    if (!w) return;
    const onLoad = () => {
      try {
        w.print();
      } catch {
        // ignore — some MIME types can't be printed inline
      }
      w.removeEventListener("load", onLoad);
    };
    w.addEventListener("load", onLoad);
  }


  function printSelectedEmail(mode: "html" | "text" = printMode) {
    if (!selectedEmail) return;
    window.open(`/api/emails/${selectedEmail.id}/print?mode=${mode}`, "_blank");
  }

  async function copyEmailsToClipboard(ids: string[]) {
    const byId = new Map(emails.map((email) => [email.id, email]));
    const payload = ids
      .map((id) => byId.get(id))
      .filter((email): email is Email => !!email)
      .map((email) => {
        const from = senderDisplayName(email);
        const subject = email.subject || "(Ohne Betreff)";
        const snippet = email.snippet || "";
        return `Von: ${from}\nBetreff: ${subject}\nVorschau: ${snippet}`;
      })
      .join("\n\n");
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setUiInfo(`${ids.length > 1 ? `${ids.length} Mails` : "Mail"} in Zwischenablage kopiert.`);
    } catch {
      setUiError("Kopieren in die Zwischenablage ist fehlgeschlagen.");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadAccounts();
      void loadContactCandidates();
      void loadSignatureSettings();
      void loadAutomationSettings();
      void loadLabels();
      void fetch("/api/compose/send-due", { method: "POST" });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!automationDashboardOpen) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutomationLoading(true);
    void (async () => {
      try {
        await Promise.all([loadAutomationSettings(), loadAutomationRuns()]);
      } finally {
        if (!cancelled) setAutomationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [automationDashboardOpen]);

  useEffect(() => {
    if (!automationDashboardOpen) return;
    if (typeof window === "undefined") return;
    if (automationRefreshRef.current !== null) {
      window.clearInterval(automationRefreshRef.current);
      automationRefreshRef.current = null;
    }
    automationRefreshRef.current = window.setInterval(() => {
      void loadAutomationRuns();
    }, 15000);
    return () => {
      if (automationRefreshRef.current !== null) {
        window.clearInterval(automationRefreshRef.current);
        automationRefreshRef.current = null;
      }
    };
  }, [automationDashboardOpen]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "mailpilot-link-click" && typeof e.data.href === "string") {
        const href: string = e.data.href;
        if (/^mailto:/i.test(href)) {
          window.location.href = href;
          return;
        }
        if (/^https?:\/\//i.test(href)) {
          setPendingLinkUrl(href);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!isBodyMaximized) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsBodyMaximized(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isBodyMaximized]);

  useEffect(() => {
    if (!isBodyMaximized) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isBodyMaximized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isBodyMaximized) setMaximizedBodyMenuOpen(false);
  }, [isBodyMaximized]);

  // Mobile: verhindert Seiten-Scroll (Adressleiste / 100vh); innere Panels scrollen stattdessen.
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
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.height = prevHtmlHeight;
      body.style.height = prevBodyHeight;
    };
  }, []);

  useEffect(() => {
    if (!selectedAccountId || isAllAccounts) {
      if (isAllAccounts) {
        const timer = setTimeout(() => {
          setFolders([]);
          setSelectedFolderPath("");
          setMoveTargetFolder("");
        }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }
    const timer = setTimeout(() => {
      void loadFolders(selectedAccountId);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedLabel) return;
    const timer = setTimeout(() => {
      void loadEmails();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedAccountId,
    selectedFolderPath,
    query,
    hasAttachmentsFilter,
    actionRequiredFilter,
    localFlagFilter,
    tab,
    sort,
    mailScrollBatchSize,
    selectedLabel,
  ]);

  useEffect(() => {
    // Invalidate in-flight detail fetches when the visible mail context changes.
    activeLoadEmailRequestIdRef.current += 1;
  }, [selectedAccountId, selectedFolderPath, query, tab, sort, hasAttachmentsFilter, actionRequiredFilter]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { shiftHeldRef.current = e.shiftKey; };
    const up = (e: KeyboardEvent) => { shiftHeldRef.current = e.shiftKey; };
    const blur = () => { shiftHeldRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  useEffect(() => {
    const root = listScrollRef.current;
    const target = loadMoreSentinelRef.current;
    if (!root || !target || !emailsHasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        void loadMoreEmailsRef.current();
      },
      { root, rootMargin: "200px", threshold: 0 },
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [emailsHasMore, emails.length, selectedAccountId, selectedFolderPath]);

  // Reset selection whenever the user pivots context (account, folder, filter,
  // search query). Otherwise selected mail-IDs would silently apply to a
  // different folder's bulk action.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(new Set());
  }, [selectedAccountId, selectedFolderPath, tab, query, hasAttachmentsFilter, actionRequiredFilter]);

  useEffect(() => {
    if (!rightDrawerEnabled && mobilePane === "right") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMobilePane("middle");
    }
    if (!selectedEmail) setMobileMovePanelOpen(false);
    if (mobilePane !== "right") setMobileMovePanelOpen(false);
  }, [selectedEmail, mobilePane, rightDrawerEnabled]);

  useEffect(() => {
    const feedbackTimeouts = swipeFeedbackTimeoutsRef.current;
    const pendingUndos = pendingSwipeTrashUndosRef.current;
    return () => {
      for (const timeoutId of Object.values(feedbackTimeouts)) {
        if (typeof timeoutId === "number") window.clearTimeout(timeoutId);
      }
      for (const pending of pendingUndos) {
        window.clearTimeout(pending.timeoutId);
      }
    };
  }, []);

  // Close the sync dropdown on Escape or when clicking elsewhere.
  useEffect(() => {
    return () => {
      if (syncAllProgressPollRef.current !== null) {
        window.clearInterval(syncAllProgressPollRef.current);
        syncAllProgressPollRef.current = null;
      }
      if (automationRefreshRef.current !== null) {
        window.clearInterval(automationRefreshRef.current);
        automationRefreshRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showSyncMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowSyncMenu(false);
    }
    function onClickAway(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-sync-menu-root]")) return;
      setShowSyncMenu(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClickAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClickAway);
    };
  }, [showSyncMenu]);

  useEffect(() => {
    if (!emailDetailMenuOpen) return;
    let cancelled = false;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setEmailDetailMenuOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-email-detail-menu-root]")) return;
      setEmailDetailMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      if (!cancelled) window.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [emailDetailMenuOpen]);

  useEffect(() => {
    if (!maximizedBodyMenuOpen) return;
    let cancelled = false;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMaximizedBodyMenuOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-max-body-menu-root]")) return;
      setMaximizedBodyMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      if (!cancelled) window.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [maximizedBodyMenuOpen]);

  // Iframe-Höhe nur per DOM setzen — kein `height` im React-`style`, sonst überschreibt jedes
  // Re-Render (z. B. nach loadBody) die Messung und schneidet lange Mails auf ~360px ab.
  useLayoutEffect(() => {
    if (bodyMode !== "html" || !safeMailDocument) return;
    const frame = mailBodyIframeRef.current;
    if (!frame) return;

    let ro: ResizeObserver | null = null;

    const measureAndApplyHeight = () => {
      const el = mailBodyIframeRef.current;
      if (!el) return;
      try {
        const doc = el.contentDocument;
        const b = doc?.body;
        const htmlEl = doc?.documentElement;
        if (!b || !htmlEl) return;
        const h = Math.max(
          b.scrollHeight,
          htmlEl.scrollHeight,
          b.offsetHeight,
          htmlEl.offsetHeight,
        );
        el.style.minHeight = `${Math.max(h + 64, 480)}px`;
      } catch {
        /* ignore */
      }
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

    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
      frame.style.height = "";
    };
  }, [safeMailDocument, bodyMode, selectedEmail?.id]);

  // --- Fast-Sync: nur INBOX im Auto-Timer ---
  async function syncInboxOnly() {
    const accountId = selectedAccountIdRef.current;
    if (!accountId || accountId === "__all__") return;
    try {
      const res = await fetch(`/api/accounts/${accountId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: "INBOX", mode: "incremental" }),
      });
      if (!res.ok) return;
      if (selectedFolderPathRef.current === "INBOX") {
        await loadEmails();
      }
      await reloadFolders();
    } catch {
      // Silent fail für Auto-Sync
    }
  }

  useEffect(() => {
    if (!selectedAccountId || isAllAccounts) return;
    const intervalMs = Math.max(5, newMailCheckIntervalMinutes) * 60 * 1000;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (isSyncing || autoCheckInFlightRef.current) return;
      autoCheckInFlightRef.current = true;
      void (async () => {
        try {
          await syncInboxOnly();
        } finally {
          autoCheckInFlightRef.current = false;
        }
      })();
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, newMailCheckIntervalMinutes, isSyncing]);

  // --- Idle-based Full-Sync ---
  const lastUserActionRef = useRef(Date.now());
  const idleFullSyncDoneRef = useRef(false);
  const IDLE_FULL_SYNC_MS = 10 * 60 * 1000; // 10 Minuten

  useEffect(() => {
    function markActive() {
      lastUserActionRef.current = Date.now();
      idleFullSyncDoneRef.current = false;
    }
    window.addEventListener("click", markActive);
    window.addEventListener("keydown", markActive);
    window.addEventListener("scroll", markActive, true);
    return () => {
      window.removeEventListener("click", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("scroll", markActive, true);
    };
  }, []);

  useEffect(() => {
    if (!selectedAccountId || isAllAccounts) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (isSyncing || autoCheckInFlightRef.current) return;
      if (idleFullSyncDoneRef.current) return;
      const idleMs = Date.now() - lastUserActionRef.current;
      if (idleMs >= IDLE_FULL_SYNC_MS) {
        idleFullSyncDoneRef.current = true;
        autoCheckInFlightRef.current = true;
        void (async () => {
          try {
            await syncAllFolders("auto");
          } finally {
            autoCheckInFlightRef.current = false;
          }
        })();
      }
    }, 2 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, isSyncing]);

  useEffect(() => {
    if (!selectedAccountId || isAllAccounts) return;
    if (typeof document === "undefined") return;
    const triggerRefresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadFolders(selectedAccountId);
    };
    const timer = window.setInterval(() => {
      triggerRefresh();
    }, FOLDER_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      triggerRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  const composeInitializedRef = useRef(false);

  useEffect(() => {
    if (!composeOpen) {
      composeInitializedRef.current = false;
      return;
    }
    if (composeInitializedRef.current || !composeEditorRef.current) return;
    composeInitializedRef.current = true;
    composeEditorRef.current.innerHTML = composeForm.bodyHtml || "";
    requestAnimationFrame(() => {
      const editor = composeEditorRef.current;
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
  }, [composeOpen]);

  useEffect(() => {
    if (!mailContextMenu) return;
    function close() {
      setMailContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [mailContextMenu]);

  // Restore persisted column widths after hydration (avoids SSR mismatch).
  function loadPersistedWidths() {
    if (typeof window === "undefined") return;
    try {
      const f = window.localStorage.getItem(FOLDER_LS_KEY);
      const l = window.localStorage.getItem(LIST_LS_KEY);
      const fw = f ? parseInt(f, 10) : NaN;
      const lw = l ? parseInt(l, 10) : NaN;
      if (Number.isFinite(fw)) {
        setFolderWidth(clamp(fw, FOLDER_WIDTH_MIN, FOLDER_WIDTH_MAX));
      }
      if (Number.isFinite(lw)) {
        setListWidth(clamp(lw, LIST_WIDTH_MIN, LIST_WIDTH_MAX));
      }
    } catch {
      // localStorage may be disabled — fall through to defaults.
    }
  }
  useEffect(() => {
    const t = setTimeout(() => {
      loadPersistedWidths();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(MOBILE_MAIN_HEADER_LS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "0") setMobileMainHeaderExpanded(false);
      if (v === "1") setMobileMainHeaderExpanded(true);
      const folderCountMode = window.localStorage.getItem(FOLDER_COUNT_MODE_LS_KEY);
      if (folderCountMode === "compact" || folderCountMode === "uga") {
        setFolderCountDisplayMode(folderCountMode);
      }
      const persistedLeftSwipeAction = window.localStorage.getItem(MOBILE_SWIPE_LEFT_ACTION_LS_KEY);
      const persistedRightSwipeAction = window.localStorage.getItem(MOBILE_SWIPE_RIGHT_ACTION_LS_KEY);
      const isSwipeAction = (value: string | null): value is MobileSwipeAction =>
        value === "none" ||
        value === "trash" ||
        value === "mark_read" ||
        value === "mark_unread" ||
        value === "print";
      if (isSwipeAction(persistedLeftSwipeAction)) {
        setLeftSwipeAction(persistedLeftSwipeAction);
      }
      if (isSwipeAction(persistedRightSwipeAction)) {
        setRightSwipeAction(persistedRightSwipeAction);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function setMobileMainHeaderExpandedPersist(next: boolean) {
    setMobileMainHeaderExpanded(next);
    try {
      window.localStorage.setItem(MOBILE_MAIN_HEADER_LS_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function setFolderCountDisplayModePersist(next: "compact" | "uga") {
    setFolderCountDisplayMode(next);
    try {
      window.localStorage.setItem(FOLDER_COUNT_MODE_LS_KEY, next);
    } catch {
      // ignore storage errors
    }
  }

  function dragFolder(dx: number) {
    setFolderWidth((prev) => {
      const next = clamp(prev + dx, FOLDER_WIDTH_MIN, FOLDER_WIDTH_MAX);
      try {
        window.localStorage.setItem(FOLDER_LS_KEY, String(next));
      } catch {
        // ignore storage errors (private mode etc.)
      }
      return next;
    });
  }
  function dragList(dx: number) {
    setListWidth((prev) => {
      const next = clamp(prev + dx, LIST_WIDTH_MIN, LIST_WIDTH_MAX);
      try {
        window.localStorage.setItem(LIST_LS_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Open a specific email when navigated from /search via ?emailId=…
  async function applyDeepLinkParams() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const emailId = url.searchParams.get("emailId");
    const acc = url.searchParams.get("accountId");
    const fld = url.searchParams.get("folder");
    if (!emailId && !acc && !fld) return;
    if (acc) setSelectedAccountId(acc);
    if (fld) setSelectedFolderPath(fld);
    if (emailId) await loadEmail(emailId);
    url.searchParams.delete("emailId");
    url.searchParams.delete("accountId");
    url.searchParams.delete("folder");
    window.history.replaceState({}, "", url.toString());
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void applyDeepLinkParams();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div
        className={`glass-solid z-20 shrink-0 items-center justify-between gap-2 border-b-0 px-2 py-1.5 lg:hidden ${
          mobileMainHeaderExpanded ? "hidden" : "flex"
        }`}
      >
        <span className="min-w-0 truncate text-xs font-semibold glass-text-primary">
          MailPilot
          {selectedAccount ? (
            <span className="font-normal glass-text-secondary"> · {selectedAccount.name}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setMobileMainHeaderExpandedPersist(true)}
          className="glass-btn shrink-0 rounded-lg p-2"
          aria-label="Hauptmenü anzeigen"
          title="Hauptmenü anzeigen"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <header
        className={`glass-solid sticky top-0 z-20 shrink-0 flex-wrap items-center gap-2 border-b-0 px-3 py-2 md:px-4 lg:flex ${
          mobileMainHeaderExpanded ? "flex" : "hidden"
        }`}
      >
        <div className="flex w-full shrink-0 items-center gap-2 lg:contents">
          <button
            onClick={() => setFoldersOpen((v) => !v)}
            aria-label={foldersOpen ? "Ordner einklappen" : "Ordner ausklappen"}
            title={foldersOpen ? "Ordner einklappen" : "Ordner ausklappen"}
            className="glass-btn rounded-lg px-2 py-1.5"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <h1 className="min-w-0 shrink truncate text-base font-semibold glass-text-primary lg:shrink-0 lg:overflow-visible lg:whitespace-normal">
            MailPilot
          </h1>
          <button
            type="button"
            onClick={() => setMobileMainHeaderExpandedPersist(false)}
            className="glass-btn ml-auto shrink-0 rounded-lg p-2 lg:hidden"
            aria-label="Hauptmenü einklappen"
            title="Mehr Platz für Mails"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>

        <select
          value={selectedAccountId}
          onChange={(e) => {
            setSelectedAccountId(e.target.value);
            setSelectedFolderPath("");
            setFolders([]);
            setMoveTargetFolder("");
            setEmails([]);
            setSelectedEmail(null);
            setBodyContent(null);
            setMobilePane("middle");
            setEmailDetailMenuOpen(false);
          }}
          className="glass-select ml-2 rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="">Konto wählen</option>
          {accounts.length > 1 && (
            <option value="__all__">Alle Konten</option>
          )}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <div className="relative ml-auto flex-1 md:max-w-md">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen in Betreff, Absender, Inhalt..."
            className="glass-input w-full rounded-lg px-3 py-1.5 text-sm"
          />
        </div>

        <div className="relative" data-sync-menu-root>
          <button
            type="button"
            onClick={() => setShowSyncMenu((v) => !v)}
            disabled={isSyncing || !selectedAccountId || isAllAccounts}
            aria-haspopup="menu"
            aria-expanded={showSyncMenu}
            aria-controls="mailpilot-sync-menu"
            className="glass-btn-dark rounded-lg px-3 py-1.5 text-sm disabled:opacity-60"
            title={isAllAccounts ? "Sync nicht verfügbar im Alle-Konten-Modus" : "Synchronisationsoptionen"}
          >
            {isSyncing ? "Synchronisiere..." : "Synchronisieren ▾"}
          </button>
          {showSyncMenu ? (
            <div
              id="mailpilot-sync-menu"
              role="menu"
              className="glass-solid absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-xl"
            >
              <button
                role="menuitem"
                onClick={() => {
                  setShowSyncMenu(false);
                  void syncAllFolders("manual");
                }}
                disabled={isSyncing || !selectedAccountId || isAllAccounts}
                className="block w-full border-b glass-divider px-3 py-2 text-left text-sm hover:bg-white/30 disabled:opacity-50"
              >
                <span className="font-medium glass-text-primary">
                  Delta-Sync (alle Ordner)
                </span>
                <span className="block text-xs glass-text-tertiary">
                  Standardlauf: Delta-Sync kontoweit über alle Verzeichnisse, inkl. Fortschritt + ETA
                </span>
              </button>
              <div className="px-3 py-2 text-xs glass-text-tertiary">
                Auto-Update nutzt denselben Delta-Sync im Intervall. Vollabgleich startet nie automatisch.
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void checkNow()}
          disabled={isSyncing || !selectedAccountId || isAllAccounts}
          className="glass-btn rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          title={isAllAccounts ? "Sync nicht verfügbar im Alle-Konten-Modus" : "Nur Inbox schnell prüfen (Fast-Sync)"}
        >
          Check jetzt
        </button>
        <button
          type="button"
          onClick={() => setAutomationDashboardOpen((v) => !v)}
          className="glass-btn rounded-lg px-3 py-1.5 text-sm"
          aria-expanded={automationDashboardOpen}
          aria-controls="mailpilot-automation-dashboard"
          title="Auto-Update Dashboard"
        >
          Auto-Update
        </button>
        <a
          href="/search"
          title="Erweiterte Suche"
          className="glass-btn rounded-lg px-3 py-1.5 text-sm"
        >
          <span className="hidden md:inline">Erweiterte Suche</span>
          <span className="md:hidden">Suche</span>
        </a>
        <a
          href="/duplicates"
          title="Duplikate erkennen"
          className="glass-btn rounded-lg px-3 py-1.5 text-sm"
        >
          <span className="hidden md:inline">Duplikate</span>
          <span className="md:hidden">Dupl.</span>
        </a>
        <a
          href="/sender-profiles"
          title="Absender-Profile"
          className="glass-btn rounded-lg px-3 py-1.5 text-sm"
        >
          <span className="hidden md:inline">Absender</span>
          <span className="md:hidden">Abs.</span>
        </a>
        <a
          href="/labels"
          title="Labels verwalten"
          className="glass-btn rounded-lg px-3 py-1.5 text-sm"
        >
          Labels
        </a>
        <a
          href="/ai-assistant"
          title="KI-Assistent"
          className="glass-btn rounded-lg px-3 py-1.5 text-sm"
        >
          ✨ KI
        </a>
        <button
          onClick={composeNewMail}
          title="Neue E-Mail"
          className="glass-btn-primary rounded-lg px-3 py-1.5 text-sm"
        >
          Neue Mail
        </button>
        <a
          href="/settings"
          aria-label="Einstellungen"
          title="Einstellungen"
          className="glass-btn rounded-lg px-2 py-1.5"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </a>
        <ThemeToggle className="glass-btn rounded-lg px-2 py-1.5" />
        <button
          onClick={logout}
          className="glass-btn rounded-lg px-3 py-1.5 text-sm"
        >
          Logout
        </button>
      </header>

      {syncProgress ? (
        <div
          className="glass-info px-4 py-1.5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <span className="text-xs">{syncProgress.label}</span>
            {syncProgress.kind === "all_folders" ? (
              <span className="text-xs glass-text-tertiary">
                Gesamt: {typeof syncProgress.totalMails === "number" ? syncProgress.totalMails : "…"} ·
                Verbleibend:{" "}
                {typeof syncProgress.remainingMails === "number" ? syncProgress.remainingMails : "…"}
                {syncProgress.isEstimate ? " (Schätzung)" : ""}
                {typeof syncProgress.etaSeconds === "number"
                  ? ` · ETA ~ ${Math.max(1, Math.round(syncProgress.etaSeconds / 60))} min`
                  : " · ETA: …"}
              </span>
            ) : null}
          </div>
          {syncProgress.kind === "all_folders" ? (
            <p
              className="mt-1 truncate text-[11px] glass-text-tertiary"
              title={syncProgress.lastFolderPath ?? undefined}
            >
              Ordner:{" "}
              {syncProgress.lastFolderPath
                ? folderDisplayName(syncProgress.lastFolderPath)
                : "wird ermittelt …"}
            </p>
          ) : null}
          <div
            className="mt-1 h-1 w-full overflow-hidden rounded-full bg-blue-200/40"
            role="progressbar"
            aria-label={syncProgress.label}
            aria-valuetext={
              syncProgress.kind === "all_folders" && typeof syncProgress.remainingMails === "number"
                ? `${syncProgress.remainingMails} verbleibend`
                : "läuft"
            }
          >
            {syncProgress.kind === "all_folders" &&
            typeof syncProgress.totalMails === "number" &&
            syncProgress.totalMails > 0 &&
            typeof syncProgress.processedMails === "number" ? (
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-700 ease-out"
                style={{
                  width: `${Math.max(
                    2,
                    Math.min(100, (syncProgress.processedMails / syncProgress.totalMails) * 100),
                  )}%`,
                }}
              />
            ) : (
              <div className="mailpilot-progress-bar h-full w-1/3 rounded-full bg-blue-500" />
            )}
          </div>
        </div>
      ) : null}

      {uiError ? (
        <p className="glass-error px-4 py-2 text-sm text-red-600">
          {uiError}
        </p>
      ) : null}
      {uiInfo ? (
        <p className="glass-info px-4 py-2 text-sm">
          {uiInfo}
        </p>
      ) : null}
      {senderProfileToast ? (
        <div className="glass-info flex flex-wrap items-center gap-2 px-4 py-2 text-sm" role="status" aria-live="polite">
          <span className="glass-text-secondary">
            E-Mail von <strong className="glass-text-primary">{senderProfileToast.fromEmail}</strong> nach{" "}
            <strong className="glass-text-primary">{senderProfileToast.targetFolder}</strong> verschoben.
          </span>
          <button
            type="button"
            onClick={() => void handleRememberSenderProfile()}
            className="glass-btn rounded-lg px-3 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-medium"
          >
            Regel merken
          </button>
          <button
            type="button"
            onClick={() => {
              if (senderProfileToastTimerRef.current) clearTimeout(senderProfileToastTimerRef.current);
              setSenderProfileToast(null);
            }}
            className="glass-btn px-1.5 py-0.5 rounded text-xs glass-text-muted"
          >
            ✕
          </button>
        </div>
      ) : null}
      {autoMoveToast ? (
        <div className="glass-info flex flex-wrap items-center gap-2 px-4 py-2 text-sm" role="status" aria-live="polite">
          <span className="glass-text-secondary">
            E-Mail automatisch verschoben nach{" "}
            <strong className="glass-text-primary">{autoMoveToast.folder}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              if (autoMoveToastTimerRef.current) clearTimeout(autoMoveToastTimerRef.current);
              setAutoMoveToast(null);
            }}
            className="glass-btn px-1.5 py-0.5 rounded text-xs glass-text-muted"
          >
            ✕
          </button>
        </div>
      ) : null}
      {pendingSwipeTrashUndos.length > 0 ? (
        <div className="glass-info flex flex-wrap items-center gap-2 px-4 py-2 text-sm" role="status" aria-live="polite">
          <span className="font-medium">
            {pendingSwipeTrashUndos.length === 1
              ? "Mail wird in 5s in den Papierkorb verschoben."
              : `${pendingSwipeTrashUndos.length} Mails werden in 5s in den Papierkorb verschoben.`}
          </span>
          {pendingSwipeTrashUndos.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                window.clearTimeout(entry.timeoutId);
                restoreSwipeTrashedEmail(entry);
              }}
              className="glass-btn rounded-lg px-2 py-1 text-xs"
            >
              Rückgängig ({senderDisplayName(entry.email)})
            </button>
          ))}
        </div>
      ) : null}

      {automationDashboardOpen ? (
        <section
          id="mailpilot-automation-dashboard"
          className="glass-subtle border-b glass-divider px-4 py-3"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold glass-text-primary">Auto-Update Dashboard</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runAutomationNow()}
                disabled={automationRunningNow || automationLoading || !selectedAccountId}
                className="glass-btn rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
              >
                {automationRunningNow ? "Läuft …" : "Jetzt ausführen"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAutomationLoading(true);
                  void (async () => {
                    try {
                      await Promise.all([loadAutomationSettings(), loadAutomationRuns()]);
                    } finally {
                      setAutomationLoading(false);
                    }
                  })();
                }}
                disabled={automationLoading}
                className="glass-btn rounded-lg px-2.5 py-1 text-xs disabled:opacity-50"
              >
                Aktualisieren
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <article className="glass rounded-xl p-3">
              <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Status</p>
              <p className="mt-1 text-sm glass-text-primary">
                {runOnAppStart
                  ? "Automatisch beim App-Start + Intervall"
                  : "Automatisch nur nach Intervall"}
              </p>
              <p className="mt-1 text-xs glass-text-tertiary">
                Automatik: Inbox-Sync alle {Math.max(5, Math.round(newMailCheckIntervalMinutes))} Minuten
                {typeof document !== "undefined" && document.visibilityState !== "visible"
                  ? " (wartet bei inaktivem Tab)"
                  : ""}
              </p>
              <p className="mt-1 text-xs glass-text-tertiary">
                Vollsync bei Inaktivität (nach 10 Min. Idle)
              </p>
              <p className="mt-1 text-xs glass-text-tertiary">
                Manuell: &quot;Check jetzt&quot; prüft nur die Inbox (Fast-Sync).
              </p>
              <p className="mt-1 text-xs glass-text-tertiary">
                Nächster Lauf: {formatDateTime(nextScheduledRunAt)}
              </p>
            </article>

            <article className="glass rounded-xl p-3">
              <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Zeitplan</p>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs glass-text-tertiary" htmlFor="automation-interval-input">
                  Intervall
                </label>
                <input
                  id="automation-interval-input"
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={newMailCheckIntervalMinutes}
                  onChange={(e) => setNewMailCheckIntervalMinutes(Math.max(5, Number(e.target.value) || 5))}
                  className="glass-input w-24 rounded-lg px-2 py-1 text-xs"
                />
                <span className="text-xs glass-text-tertiary">min</span>
                <button
                  type="button"
                  onClick={() =>
                    void saveAutomationDashboardSettings({
                      runIntervalMinutes: Math.max(5, Math.round(newMailCheckIntervalMinutes)),
                    })
                  }
                  disabled={automationSaving}
                  className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                >
                  Speichern
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs glass-text-secondary">
                <input
                  type="checkbox"
                  checked={runOnAppStart}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRunOnAppStart(checked);
                    void saveAutomationDashboardSettings({ runOnAppStart: checked });
                  }}
                />
                Beim App-Start automatisch prüfen
              </label>
            </article>

            <article className="glass rounded-xl p-3">
              <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Letzter Lauf</p>
              {automationRuns.length > 0 ? (
                <>
                  <p className="mt-1 text-sm glass-text-primary">
                    {formatDateTime(automationRuns[0]?.startedAt)} ({formatRelative(automationRuns[0]?.startedAt)})
                  </p>
                  <span
                    className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      formatStatusBadge(automationRuns[0]?.status).className
                    }`}
                  >
                    {formatStatusBadge(automationRuns[0]?.status).label}
                  </span>
                </>
              ) : (
                <p className="mt-1 text-xs glass-text-tertiary">Noch keine Laufdaten vorhanden.</p>
              )}
            </article>
          </div>

          <div className="mt-3 glass rounded-xl p-3">
            <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Letzte Läufe</p>
            {automationLoading ? (
              <p className="mt-2 text-xs glass-text-tertiary">Lade Laufhistorie …</p>
            ) : automationRuns.length === 0 ? (
              <p className="mt-2 text-xs glass-text-tertiary">Keine Läufe gefunden.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {automationRuns.map((run) => {
                  const hasError = Boolean(run.error);
                  return (
                    <li
                      key={run.id}
                      className={`rounded-lg border px-2 py-1 text-xs ${
                        hasError ? "border-red-400/40 bg-red-500/10" : "border-white/30 bg-white/10"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {run.type} · {run.status}
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              formatStatusBadge(run.status).className
                            }`}
                          >
                            {formatStatusBadge(run.status).label}
                          </span>
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

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-x-none lg:flex-row"
        onTouchStart={handleDrawerGestureStart}
        onTouchMove={handleDrawerGestureMove}
        onTouchEnd={handleDrawerGestureEnd}
        style={
          {
            "--mp-folder-w": `${folderWidth}px`,
            "--mp-list-w": `${listWidth}px`,
          } as CSSProperties
        }
      >
        <div
          className={`fixed inset-0 z-30 bg-black/35 transition-opacity duration-300 lg:hidden ${
            isMobileDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => openMobilePane("middle")}
          aria-hidden={!isMobileDrawerOpen}
        />
        {foldersOpen ? (
          <aside
            className={`glass min-w-0 shrink-0 overflow-x-hidden border-r-0 lg:static lg:z-auto lg:max-h-none lg:w-[var(--mp-folder-w)] lg:shrink-0 lg:flex lg:flex-col ${
              isMobileLeftPaneVisible
                ? "fixed inset-0 z-40 block overflow-y-auto"
                : "hidden lg:flex"
            }`}
            style={{
              paddingTop: isMobileLeftPaneVisible ? "env(safe-area-inset-top)" : undefined,
            }}
          >
            <div className="lg:shrink-0 border-b glass-divider px-3 py-2 space-y-2">
              <div className="flex items-center justify-between lg:hidden">
                <span className="text-xs font-semibold uppercase tracking-wide glass-text-muted">Navigation</span>
                <button
                  type="button"
                  onClick={() => openMobilePane("middle")}
                  className="glass-btn rounded-lg px-2 py-1 text-xs"
                  aria-label="Navigation schließen"
                  title="Zur Mail-Liste"
                >
                  Schließen
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide glass-text-muted">
                  Ordner
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setFolderCountDisplayModePersist("compact")}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      folderCountDisplayMode === "compact"
                        ? "bg-white/35 glass-text-primary"
                        : "glass-text-muted hover:bg-white/20"
                    }`}
                    title="Kompakte Zähleranzeige (U + A)"
                    aria-pressed={folderCountDisplayMode === "compact"}
                  >
                    Kompakt
                  </button>
                  <button
                    type="button"
                    onClick={() => setFolderCountDisplayModePersist("uga")}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      folderCountDisplayMode === "uga"
                        ? "bg-white/35 glass-text-primary"
                        : "glass-text-muted hover:bg-white/20"
                    }`}
                    title="Explizite Zähleranzeige (U/G/A)"
                    aria-pressed={folderCountDisplayMode === "uga"}
                  >
                    U/G/A
                  </button>
                  <button
                    onClick={() => void reloadFolders()}
                    className="text-xs glass-text-muted hover:opacity-80"
                    title="Ordner aktualisieren"
                  >
                    ↻
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={createFolderPrompt}
                  disabled={isManagingFolder || !selectedAccountId}
                  className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  title="Neuen Ordner erstellen"
                >
                  + Ordner
                </button>
                <button
                  type="button"
                  onClick={renameFolderPrompt}
                  disabled={isManagingFolder || !selectedFolderPath}
                  className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  title="Ausgewählten Ordner umbenennen / verschieben"
                >
                  Umbenennen
                </button>
                <button
                  type="button"
                  onClick={copyFolderPrompt}
                  disabled={isManagingFolder || !selectedFolderPath}
                  className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  title="Ausgewählten Ordner kopieren"
                >
                  Kopieren
                </button>
                <button
                  type="button"
                  onClick={deleteFolderPrompt}
                  disabled={isManagingFolder || !selectedFolderPath}
                  className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  title="Ausgewählten Ordner löschen"
                >
                  Löschen
                </button>
              </div>
              {selectedFolderPath ? (
                <p className="text-[11px] glass-text-muted truncate" title={selectedFolderPath}>
                  Aktuell: {folderDisplayName(selectedFolderPath)}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-1 border-t glass-divider pt-2 lg:hidden">
                <button
                  type="button"
                  onClick={() => void checkNow()}
                  disabled={isSyncing || !selectedAccountId}
                  className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  title="Delta-Sync jetzt starten"
                >
                  Sync
                </button>
                <a
                  href="/search"
                  className="glass-btn rounded-lg px-2 py-1 text-center text-xs"
                  title="Erweiterte Suche"
                >
                  Detailsuche
                </a>
                <a
                  href="/duplicates"
                  className="glass-btn rounded-lg px-2 py-1 text-center text-xs"
                  title="Duplikate erkennen"
                >
                  Duplikate
                </a>
                <a
                  href="/settings"
                  className="glass-btn rounded-lg px-2 py-1 text-center text-xs"
                  title="Einstellungen"
                >
                  Settings
                </a>
                <a
                  href="/sender-profiles"
                  className="glass-btn rounded-lg px-2 py-1 text-center text-xs"
                  title="Absender-Profile"
                >
                  Absender
                </a>
                <a
                  href="/ai-assistant"
                  className="glass-btn rounded-lg px-2 py-1 text-center text-xs"
                  title="KI-Assistent"
                >
                  AI
                </a>
              </div>
              <div className="space-y-2 rounded-lg border border-white/25 bg-white/10 p-2 lg:hidden">
                <p className="text-[11px] font-semibold uppercase tracking-wide glass-text-muted">
                  Swipe-Aktionen
                </p>
                <label className="block text-xs glass-text-secondary">
                  Links wischen
                  <select
                    value={leftSwipeAction}
                    onChange={(e) => setLeftSwipeActionPersist(e.target.value as MobileSwipeAction)}
                    className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
                    aria-label="Aktion bei Swipe nach links"
                    title="Aktion bei Swipe nach links"
                  >
                    {MOBILE_SWIPE_ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs glass-text-secondary">
                  Rechts wischen
                  <select
                    value={rightSwipeAction}
                    onChange={(e) => setRightSwipeActionPersist(e.target.value as MobileSwipeAction)}
                    className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
                    aria-label="Aktion bei Swipe nach rechts"
                    title="Aktion bei Swipe nach rechts"
                  >
                    {MOBILE_SWIPE_ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto overflow-x-hidden py-1 text-sm">
              {folders.length === 0 ? (
                <p className="px-3 py-2 text-xs glass-text-muted">
                  {selectedAccountId ? "Lade Ordner..." : "Kein Konto gewählt."}
                </p>
              ) : (
                <ul>
                  <li>
                    <button
                      onClick={() => setAccountExpanded((v) => !v)}
                      className="flex w-full items-center gap-1 px-2 py-1 text-left text-sm font-semibold glass-text-primary hover:bg-white/30"
                      title={selectedAccount?.name ?? accountRootLabel}
                    >
                      <span className="flex h-6 w-5 shrink-0 items-center justify-center text-[10px] glass-text-muted">
                        {accountExpanded ? "▼" : "▶"}
                      </span>
                      <span className="truncate">{accountRootLabel}</span>
                    </button>
                    {accountExpanded ? (
                      <ul>
                        {folderTree.map((node) => (
                          <FolderTreeRow
                            key={node.path}
                            node={node}
                            depth={1}
                            expanded={effectiveExpandedFolderPaths}
                            onToggle={toggleFolderExpanded}
                            selectedPath={selectedFolderPath}
                            countDisplayMode={folderCountDisplayMode}
                            dragOverPath={dragOverFolderPath ?? undefined}
                            onDragOver={handleFolderDragOver}
                            onDragLeave={handleFolderDragLeave}
                            onDrop={handleFolderDrop}
                            onFolderDrop={handleFolderMoveByDrag}
                            onSelect={(path) => {
                              setSelectedLabel(null);
                              setSelectedFolderPath(path);
                              setSelectedEmail(null);
                              setBodyContent(null);
                              setMobilePane("middle");
                              setEmailDetailMenuOpen(false);
                            }}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                </ul>
              )}
              {/* --- Labels (virtuelle Ordner) --- */}
              {labelList.length > 0 || !isAllAccounts ? (
                <div className="mt-2 border-t glass-divider pt-2">
                  <button
                    onClick={() => setLabelsExpanded((v) => !v)}
                    className="flex w-full items-center gap-1 px-2 py-1 text-left text-sm font-semibold glass-text-primary hover:bg-white/30"
                  >
                    <span className="flex h-6 w-5 shrink-0 items-center justify-center text-[10px] glass-text-muted">
                      {labelsExpanded ? "▼" : "▶"}
                    </span>
                    <span className="truncate">Labels</span>
                  </button>
                  {labelsExpanded ? (
                    <ul className="space-y-0.5 pl-1">
                      {labelList.map((label) => (
                        <li key={label.id}>
                          <button
                            onClick={() => {
                              void loadEmailsByLabel(label.name);
                              setMobilePane("middle");
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-1 text-left text-sm transition-colors ${
                              selectedLabel === label.name
                                ? "glass-active"
                                : "glass-text-secondary hover:bg-white/30"
                            }`}
                          >
                            <span
                              className="h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: label.color ?? "#6b7280" }}
                            />
                            <span className="min-w-0 flex-1 truncate">{label.name}</span>
                            <span className={`shrink-0 text-xs tabular-nums ${
                              selectedLabel === label.name ? "text-white/80" : "glass-text-muted"
                            }`}>
                              {label.emailCount > 0 ? label.emailCount : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                      <li>
                        <a
                          href="/labels"
                          className="flex items-center gap-2 rounded-lg px-3 py-1 text-left text-xs glass-text-muted hover:bg-white/30"
                        >
                          Labels verwalten
                        </a>
                      </li>
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}

        {foldersOpen ? (
          <ResizeHandle onDrag={dragFolder} ariaLabel="Ordnerbreite ändern" />
        ) : null}

        <section
          className="glass-subtle relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden border-r-0 lg:flex-none lg:w-[var(--mp-list-w)] lg:shrink-0"
        >
          <div className="flex items-center gap-3 border-b glass-divider px-3 py-2">
            <div className="flex gap-3 text-sm">
              <button
                onClick={() => setTab("all")}
                className={`relative pb-1 ${
                  tab === "all"
                    ? "font-semibold glass-text-primary after:absolute after:inset-x-0 after:-bottom-[5px] after:h-[2px] after:bg-current"
                    : "glass-text-muted hover:opacity-80"
                }`}
              >
                Alle
              </button>
              <button
                onClick={() => setTab("unread")}
                className={`relative pb-1 ${
                  tab === "unread"
                    ? "font-semibold glass-text-primary after:absolute after:inset-x-0 after:-bottom-[5px] after:h-[2px] after:bg-current"
                    : "glass-text-muted hover:opacity-80"
                }`}
              >
                Ungelesen
              </button>
            </div>
            <select
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as "date_desc" | "date_asc" | "from_asc" | "subject_asc")
              }
              className="glass-select ml-auto rounded-lg px-2 py-1 text-xs"
            >
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
                checked={emails.length > 0 && emails.every((e) => selectedIds.has(e.id))}
                ref={(el) => {
                  if (el) {
                    const someSelected = emails.some((e) => selectedIds.has(e.id));
                    const allSelected =
                      emails.length > 0 && emails.every((e) => selectedIds.has(e.id));
                    el.indeterminate = someSelected && !allSelected;
                  }
                }}
                onChange={toggleSelectAllVisible}
              />
              Alle
            </label>
            <button
              onClick={() => setHasAttachmentsFilter((v) => !v)}
              className={`rounded-full px-2 py-0.5 text-xs transition-all ${
                hasAttachmentsFilter
                  ? "glass-btn-dark"
                  : "glass-btn"
              }`}
            >
              Mit Anhängen
            </button>
            <button
              onClick={() => setActionRequiredFilter((v) => !v)}
              className={`rounded-full px-2 py-0.5 text-xs transition-all ${
                actionRequiredFilter
                  ? "glass-btn-dark"
                  : "glass-btn"
              }`}
            >
              Aktion erforderlich
            </button>
            <label className="ml-auto flex items-center gap-1 text-xs glass-text-secondary">
              <span>Flag</span>
              <select
                value={localFlagFilter}
                onChange={(e) => setLocalFlagFilter(e.target.value as LocalFlagFilter)}
                className="glass-select rounded-lg px-2 py-1 text-xs"
              >
                <option value="all">Alle</option>
                <option value="none">Ohne</option>
                <option value="red">Rot</option>
                <option value="yellow">Gelb</option>
                <option value="green">Grün</option>
              </select>
            </label>
            {folderEmptyKind ? (
              <button
                onClick={() => {
                  setEmptyConfirmText("");
                  setEmptyFolderModalOpen(true);
                }}
                className="glass-btn ml-auto rounded-lg px-2 py-0.5 text-xs text-red-600"
                title={
                  folderEmptyKind === "trash"
                    ? "Alle Mails im Papierkorb endgültig entfernen"
                    : "Alle Mails im Spam-Ordner endgültig entfernen"
                }
              >
                {folderEmptyKind === "trash" ? "Papierkorb leeren" : "Spam leeren"}
              </button>
            ) : null}
          </div>

          {selectedIds.size > 0 ? (
            <div className="glass-info flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="font-medium">
                {selectedIds.size} ausgewählt
              </span>
              <span className="glass-text-muted">— Rechtsklick für Aktionen</span>
              <button
                onClick={clearSelection}
                className="glass-btn ml-auto rounded-lg px-2 py-1"
              >
                ✕ Aufheben
              </button>
            </div>
          ) : null}

          <div
            ref={listScrollRef}
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          >
            {isLoadingEmails ? (
              <p className="px-4 py-3 text-sm glass-text-secondary">Lade E-Mails...</p>
            ) : null}
            {!isLoadingEmails && emails.length === 0 ? (
              <p className="px-4 py-6 text-sm glass-text-muted">
                Keine E-Mails für die aktuellen Filter.
              </p>
            ) : null}
            <ul className="divide-y glass-divider overflow-x-hidden">
              {emails.map((email) => {
                const unread = isUnread(email);
                const sender = senderDisplayName(email);
                const seed = email.fromEmail || email.fromName || email.id;
                const isSelected = selectedEmail?.id === email.id;
                const isChecked = selectedIds.has(email.id);
                const localFlag = email.localFlag ?? null;
                const indexedAttachmentCount = email.attachmentCount ?? 0;
                const attachmentCount =
                  indexedAttachmentCount > 0
                    ? indexedAttachmentCount
                    : email.hasAttachments
                      ? 1
                      : email.attachments?.length ?? 0;
                const attachmentNames = (email.attachments ?? [])
                  .map((attachment) => getAttachmentDisplayName(attachment))
                  .filter(Boolean);
                const visibleAttachmentNames = attachmentNames.slice(0, 2);
                const hiddenAttachmentNames = Math.max(0, attachmentCount - visibleAttachmentNames.length);
                const swipeOffset = mailSwipeOffsets[email.id] ?? 0;
                const swipePreviewDirection = swipeOffset < -42 ? "left" : swipeOffset > 42 ? "right" : null;
                const swipePreviewAction = swipePreviewDirection
                  ? getSwipeActionForDirection(swipePreviewDirection)
                  : "none";
                const swipeFeedbackAction = mailSwipeFeedback[email.id];
                const swipeActiveLabel = swipeFeedbackAction
                  ? getMobileSwipeActionLabel(swipeFeedbackAction)
                  : getMobileSwipeActionLabel(swipePreviewAction);
                return (
                  <li key={email.id} className="min-w-0 overflow-x-hidden">
                    <div
                      className={`relative overflow-hidden rounded-xl ${
                        swipeOffset !== 0 ? "bg-blue-500/15" : ""
                      }`}
                      data-mail-row-swipe
                    >
                      <div
                        className={`pointer-events-none absolute inset-0 z-0 flex items-center px-3 text-xs font-semibold transition-opacity ${
                          swipePreviewDirection || swipeFeedbackAction ? "opacity-100" : "opacity-0"
                        } ${
                          swipePreviewDirection === "right" ||
                          (swipeFeedbackAction &&
                            getSwipeActionForDirection("right") === swipeFeedbackAction &&
                            swipeOffset >= 0)
                            ? "justify-start text-emerald-700"
                            : "justify-end text-blue-700"
                        }`}
                        aria-hidden
                      >
                        {swipePreviewDirection || swipeFeedbackAction ? swipeActiveLabel : ""}
                      </div>
                    <div
                      draggable
                      onDragStart={(e) => {
                        const dragIds =
                          selectedIds.size > 1 && selectedIds.has(email.id)
                            ? Array.from(selectedIds)
                            : [email.id];
                        e.dataTransfer.setData("text/x-mailpilot-email-id", email.id);
                        e.dataTransfer.setData("text/x-mailpilot-email-ids", JSON.stringify(dragIds));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onContextMenu={(e) => openMailContextMenu(e, email)}
                      onTouchStart={(e) => handleMailRowSwipeStart(email.id, e)}
                      onTouchMove={(e) => handleMailRowSwipeMove(email.id, e)}
                      onTouchEnd={(e) => {
                        void handleMailRowSwipeEnd(email, e);
                      }}
                      style={{ transform: `translateX(${swipeOffset}px)` }}
                      className={`flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-xl px-2 py-2 text-left transition-all cursor-grab active:cursor-grabbing ${
                        isSelected || isChecked
                          ? "glass-selected border-2"
                          : "border-2 border-transparent hover:bg-white/40"
                      }`}
                    >
                      <div className="mt-2 flex shrink-0 flex-col items-center gap-3 px-1" onClick={(e) => e.stopPropagation()}>
                        <label
                          className="flex cursor-pointer items-center"
                          onClick={(e) => {
                            e.preventDefault();
                            toggleSelected(email.id, e.shiftKey);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            readOnly
                            aria-label="E-Mail auswählen"
                          />
                        </label>
                        <button
                          onClick={() => {
                            void runActionForEmail(email.id, `/api/emails/${email.id}/move`, { targetSpecial: "trash" });
                          }}
                          className="rounded p-0.5 text-gray-400 hover:text-red-600 transition-colors"
                          aria-label="In Papierkorb verschieben"
                          title="Papierkorb"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex min-w-0 flex-1 items-start gap-2 overflow-hidden">
                        <button
                          onClick={(e) => {
                            if (e.shiftKey) {
                              toggleSelected(email.id, true);
                              return;
                            }
                            loadEmail(email.id);
                          }}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            setPopupEmailId(email.id);
                          }}
                          className="flex min-w-0 flex-1 items-start gap-3 overflow-hidden text-left"
                        >
                          <span className="mt-0.5 flex shrink-0 flex-col items-center gap-1">
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ${getAvatarColor(
                            seed,
                          )}`}
                        >
                          {getInitials(email.fromName, email.fromEmail)}
                        </span>
                        {attachmentCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                            <svg
                              aria-hidden="true"
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-4 w-4 text-blue-700"
                            >
                              <path d="M21.44 11.05l-8.49 8.49a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.82-2.83l8.48-8.48" />
                            </svg>
                            <span className="leading-none">{attachmentCount}</span>
                          </span>
                        ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-1">
                          <span
                            className={`min-w-0 truncate text-sm ${
                              unread ? "font-semibold glass-text-primary" : "glass-text-secondary"
                            }`}
                          >
                            {sender}
                          </span>
                            </span>
                            <span className="flex items-baseline justify-between gap-1">
                          <span
                            className={`min-w-0 truncate text-sm ${
                              unread ? "font-semibold glass-text-primary" : "glass-text-secondary"
                            }`}
                          >
                            {email.subject || "(Ohne Betreff)"}
                          </span>
                            </span>
                            <span className="block text-xs tabular-nums glass-text-secondary">
                              {formatDateTimeShort(email.date ?? email.createdAt)}
                            </span>
                            <span className="block truncate text-xs glass-text-muted">
                              {email.snippet ?? ""}
                            </span>
                            {attachmentCount > 0 ? (
                              <span className="mt-1 block truncate text-[11px] text-blue-700">
                                Anhaenge:{" "}
                                {visibleAttachmentNames.length > 0
                                  ? visibleAttachmentNames.join(", ")
                                  : "Anhang"}
                                {hiddenAttachmentNames > 0 ? ` +${hiddenAttachmentNames} weitere` : ""}
                              </span>
                            ) : null}
                            <span className="mt-1 flex flex-wrap gap-1">
                              {(() => {
                                const badge = getAccountBadgeInfo(accounts, email.accountId);
                                if (!badge) return null;
                                return (
                                  <span
                                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                                    style={{ backgroundColor: badge.bg, color: badge.text }}
                                  >
                                    {badge.label}
                                  </span>
                                );
                              })()}
                              {email.aiCategory ? (
                                <span className="glass-badge-accent text-[10px]">
                                  {email.aiCategory}
                                </span>
                              ) : null}
                              {email.aiPriority && email.aiPriority !== "normal" ? (
                                <span
                                  className="glass-badge text-[10px]"
                                  style={{ color: "var(--text-secondary)" }}
                                >
                                  {email.aiPriority}
                                </span>
                              ) : null}
                              {email.actionRequired ? (
                                <span className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] text-red-600">
                                  Aktion
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                        <div className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
                          <div className="flex flex-col gap-1">
                            {(Object.keys(LOCAL_FLAG_META) as Array<"red" | "yellow" | "green">).map((flagValue) => {
                              const meta = LOCAL_FLAG_META[flagValue];
                              const active = localFlag === flagValue;
                              return (
                                <button
                                  key={flagValue}
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void setLocalFlag(email.id, active ? null : flagValue);
                                  }}
                                  aria-label={`Flag ${meta.label} ${active ? "entfernen" : "setzen"}`}
                                  title={`Flag ${meta.label}`}
                                  className={`h-5 w-5 rounded-full border text-[10px] leading-none transition-all ${
                                    active
                                      ? meta.className
                                      : "border-slate-300/70 bg-white/55 text-slate-300 hover:border-slate-400 hover:text-slate-500"
                                  }`}
                                >
                                  ●
                                </button>
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
            {emails.length > 0 && emailsHasMore ? (
              <div
                ref={loadMoreSentinelRef}
                className="h-px w-full shrink-0"
                aria-hidden
              />
            ) : null}
            {isLoadingMoreEmails ? (
              <p className="px-4 py-3 text-center text-xs glass-text-muted">Lade weitere Mails…</p>
            ) : null}
            {!isLoadingEmails && emails.length > 0 && !emailsHasMore ? (
              <p className="px-4 py-3 text-center text-xs text-gray-400">Alle geladenen Mails angezeigt.</p>
            ) : null}
          </div>
        </section>

        <ResizeHandle onDrag={dragList} ariaLabel="Listenbreite ändern" />

        <section
          className={`glass-heavy min-h-0 lg:flex-col lg:static lg:z-auto lg:min-w-0 lg:flex-1 lg:w-auto lg:flex ${
            isMobileRightPaneVisible
              ? "fixed inset-0 z-40 block overflow-y-auto"
              : "hidden lg:flex"
          }`}
          style={{
            paddingTop: isMobileRightPaneVisible ? "env(safe-area-inset-top)" : undefined,
          }}
        >
          {selectedEmail ? (
            <>
              <div className="flex items-center gap-2 border-b glass-divider px-3 py-2 lg:hidden">
                <button
                  type="button"
                  onClick={() => openMobilePane("left")}
                  className="glass-btn rounded-lg px-2.5 py-1 text-xs"
                  aria-label="Zu Konto und Ordnern"
                  title="Konto und Ordner"
                >
                  ← Ordner
                </button>
                <button
                  type="button"
                  onClick={() => openMobilePane("middle")}
                  className="glass-btn rounded-lg px-2.5 py-1 text-xs"
                  aria-label="Zur Mail-Liste"
                  title="Mail-Liste"
                >
                  Liste
                </button>
              </div>

              <div className="flex items-center gap-2 border-b glass-divider px-3 py-2 md:px-4">
                <span
                  className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white sm:flex ${getAvatarColor(
                    selectedEmail.fromEmail || selectedEmail.fromName || selectedEmail.id,
                  )}`}
                  aria-hidden
                >
                  {getInitials(selectedEmail.fromName, selectedEmail.fromEmail)}
                </span>
                <h2 className="min-w-0 flex-1 truncate text-base font-semibold glass-text-primary md:text-lg">
                  {selectedEmail.subject || "(Ohne Betreff)"}
                </h2>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-medium glass-text-tertiary">Eingang</p>
                  <p className="text-sm tabular-nums font-medium glass-text-primary">
                    {formatDateTimeShort(selectedEmail.date ?? selectedEmail.createdAt)}
                  </p>
                </div>
                <div className="relative hidden shrink-0 lg:block" data-email-detail-menu-root>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmailDetailMenuOpen((v) => !v);
                    }}
                    aria-label="Mail-Details und Befehle"
                    aria-expanded={emailDetailMenuOpen}
                    aria-haspopup="menu"
                    className="glass-btn flex h-10 w-10 items-center justify-center rounded-lg"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-5 w-5"
                      aria-hidden
                    >
                      <circle cx="12" cy="5" r="1.75" />
                      <circle cx="12" cy="12" r="1.75" />
                      <circle cx="12" cy="19" r="1.75" />
                    </svg>
                  </button>
                  {emailDetailMenuOpen ? (
                    <div
                      role="menu"
                      className="glass-solid absolute right-0 z-30 mt-1 max-h-[min(85vh,560px)] w-[min(calc(100vw-2rem),18rem)] overflow-y-auto rounded-xl py-2 text-sm"
                    >
                      <div className="border-b glass-divider px-3 pb-2">
                        <p className="text-xs font-semibold uppercase tracking-wide glass-text-muted">
                          Details
                        </p>
                        <p className="mt-1 break-words text-sm font-medium glass-text-primary">
                          {selectedEmail.subject || "(Ohne Betreff)"}
                        </p>
                        <p className="mt-2 text-xs glass-text-secondary">
                          {senderDisplayName(selectedEmail)}
                          {selectedEmail.fromEmail ? (
                            <span className="block break-all glass-text-tertiary">
                              &lt;{selectedEmail.fromEmail}&gt;
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 break-words text-xs glass-text-tertiary">
                          An: {(selectedEmail.toEmails ?? []).join(", ") || "—"}
                        </p>
                        <p className="mt-1 text-xs glass-text-muted">
                          Eingang: {formatDetailDate(selectedEmail.date ?? selectedEmail.createdAt)}
                        </p>
                        <p className="text-xs glass-text-muted">
                          Gesendet: {formatDetailDate(selectedEmail.date)}
                        </p>
                      </div>

                      {bodyContent && bodyContent.html && bodyContent.text ? (
                        <div className="border-b glass-divider px-3 py-2">
                          <p className="text-xs font-semibold glass-text-muted">Ansicht</p>
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              onClick={() => setBodyMode("text")}
                              className={`flex-1 rounded-lg px-2 py-1 text-xs ${
                                bodyMode === "text"
                                  ? "glass-btn-dark"
                                  : "glass-btn"
                              }`}
                            >
                              Text
                            </button>
                            <button
                              type="button"
                              onClick={() => setBodyMode("html")}
                              className={`flex-1 rounded-lg px-2 py-1 text-xs ${
                                bodyMode === "html"
                                  ? "glass-btn-dark"
                                  : "glass-btn"
                              }`}
                            >
                              HTML
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="border-b glass-divider px-3 py-2">
                        <p className="text-xs font-semibold glass-text-muted">Druck</p>
                        <select
                          value={printMode}
                          onChange={(e) => setPrintMode(e.target.value as "html" | "text")}
                          className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
                          title="Druckmodus"
                        >
                          <option value="html">Druck: HTML</option>
                          <option value="text">Druck: Text</option>
                        </select>
                        {bodyContent && (bodyContent.html || bodyContent.text) ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEmailDetailMenuOpen(false);
                              setIsBodyMaximized(true);
                            }}
                            className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs"
                          >
                            Inhalt vergrößern
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setEmailDetailMenuOpen(false);
                            void loadBody(selectedEmail.id, true);
                          }}
                          className="glass-btn mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          Inhalt neu laden
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          replyToSelected();
                        }}
                        className="block w-full px-3 py-2 text-left font-medium hover:bg-white/30 rounded-lg"
                      >
                        Antworten
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          forwardSelected();
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg"
                      >
                        Weiterleiten
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void runAction(`/api/emails/${selectedEmail.id}/mark-read`);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg"
                      >
                        Gelesen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void runAction(`/api/emails/${selectedEmail.id}/mark-unread`);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg"
                      >
                        Ungelesen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void runAction(`/api/emails/${selectedEmail.id}/move`, {
                            targetSpecial: "trash",
                          });
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg"
                      >
                        Papierkorb
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void runAction(`/api/emails/${selectedEmail.id}/move`, {
                            targetSpecial: "spam",
                          });
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg"
                      >
                        Spam
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          printSelectedEmail();
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-white/30 rounded-lg"
                      >
                        Drucken
                      </button>

                      <div className="my-1 border-t border-gray-100" />
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void runAction(`/api/emails/${selectedEmail.id}/analyze`);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        KI analysieren
                      </button>
                      <div className="px-3 py-2">
                        <select
                          value={moveTargetFolder}
                          onChange={(e) => setMoveTargetFolder(e.target.value)}
                          className="glass-select w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="">Ordner wählen…</option>
                          {folders.map((folder) => (
                            <option key={folder.path} value={folder.path}>
                              {folder.displayName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setEmailDetailMenuOpen(false);
                            void moveToSelectedFolder();
                          }}
                          className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs"
                        >
                          Verschieben
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void blockSender();
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        Absender blockieren
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void blockDomain();
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        Domain blockieren
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void createContactSuggestion();
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        Kontaktvorschlag erzeugen
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-b glass-divider px-4 py-3 lg:hidden">
                <p className="text-sm font-medium glass-text-primary">{senderDisplayName(selectedEmail)}</p>
                {selectedEmail.fromEmail ? (
                  <p className="text-xs break-all glass-text-secondary">&lt;{selectedEmail.fromEmail}&gt;</p>
                ) : null}
                <p className="mt-1 text-xs glass-text-muted">
                  An: {(selectedEmail.toEmails ?? []).join(", ") || "—"}
                </p>
                <p className="text-xs glass-text-muted">
                  Eingang: {formatDetailDate(selectedEmail.date ?? selectedEmail.createdAt)}
                </p>
                <p className="text-xs glass-text-muted">
                  Gesendet: {formatDetailDate(selectedEmail.date)}
                </p>
                {selectedEmail.attachments.length > 0 ? (
                  <p className="mt-1 text-xs glass-text-secondary">
                    Anhänge: {selectedEmail.attachments.length}
                  </p>
                ) : null}
              </div>

              {/* --- Label-Chips --- */}
              <div className="flex flex-wrap items-center gap-1.5 border-b glass-divider px-4 py-2">
                {(selectedEmail.labels ?? []).map((label) => {
                  const def = labelList.find((l) => l.name === label);
                  return (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: def?.color ?? "#6b7280" }}
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => void removeLabelFromEmail(selectedEmail.id, label)}
                        className="ml-0.5 hover:opacity-70"
                        aria-label={`Label ${label} entfernen`}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setLabelDropdownOpen((v) => !v)}
                    className="glass-btn rounded-full px-2 py-0.5 text-xs"
                  >
                    + Label
                  </button>
                  {labelDropdownOpen ? (
                    <div className="glass-solid absolute left-0 z-30 mt-1 w-48 rounded-xl py-1 text-sm shadow-lg">
                      {labelList.map((label) => (
                        <button
                          key={label.id}
                          type="button"
                          onClick={() => {
                            void addLabelToEmail(selectedEmail.id, label.name);
                            setLabelDropdownOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/30 rounded-lg"
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: label.color ?? "#6b7280" }}
                          />
                          <span className="truncate">{label.name}</span>
                        </button>
                      ))}
                      <div className="border-t glass-divider mt-1 pt-1 px-2">
                        <div className="flex gap-1">
                          <input
                            value={newLabelInline}
                            onChange={(e) => setNewLabelInline(e.target.value)}
                            placeholder="Neues Label..."
                            className="glass-input flex-1 rounded-lg px-2 py-1 text-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && newLabelInline.trim()) {
                                void createAndAddLabel(selectedEmail.id, newLabelInline.trim());
                                setNewLabelInline("");
                                setLabelDropdownOpen(false);
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (newLabelInline.trim()) {
                                void createAndAddLabel(selectedEmail.id, newLabelInline.trim());
                                setNewLabelInline("");
                                setLabelDropdownOpen(false);
                              }
                            }}
                            className="glass-btn rounded-lg px-2 py-1 text-xs"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* --- Auto-Prompt: Unbekannter Absender (Feature 1) --- */}
              {senderPromptVisible && senderPromptData ? (
                <div className="border-b glass-divider px-4 py-3 glass-info">
                  <p className="text-sm font-medium glass-text-primary">
                    Absender &quot;{senderPromptData.email}&quot; noch nicht klassifiziert
                  </p>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs glass-text-muted mb-0.5">Kategorie</label>
                      <select
                        value={senderPromptCategory}
                        onChange={(e) => setSenderPromptCategory(e.target.value)}
                        className="glass-select rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="Kunde">Kunde</option>
                        <option value="Lieferant">Lieferant</option>
                        <option value="Subunternehmer">Subunternehmer</option>
                        <option value="Privat">Privat</option>
                        <option value="Werbung">Werbung</option>
                        <option value="Sonstiges">Sonstiges</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs glass-text-muted mb-0.5">Zielordner</label>
                      <select
                        value={senderPromptFolder}
                        onChange={(e) => setSenderPromptFolder(e.target.value)}
                        className="glass-select rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="">— Ordner wählen —</option>
                        {folders.map((f) => (
                          <option key={f.path} value={f.path}>{f.path}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void handleSenderPromptSave()}
                        disabled={senderPromptSaving}
                        className="glass-btn-primary rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        {senderPromptSaving ? "..." : "Profil speichern"}
                      </button>
                      <button
                        type="button"
                        onClick={handleSenderPromptSkip}
                        className="glass-btn rounded-lg px-3 py-1 text-xs"
                      >
                        Überspringen
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSenderPromptIgnore()}
                        disabled={senderPromptSaving}
                        className="glass-btn rounded-lg px-3 py-1 text-xs glass-text-muted disabled:opacity-50"
                      >
                        Nie wieder fragen
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {isLoadingDetail ? (
                <p className="px-4 py-2 text-sm glass-text-secondary">Lade Detail...</p>
              ) : null}

              <div className="px-3 py-2 pb-24 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-4 lg:py-4 lg:pb-4 flex flex-col">
                {selectedEmail.aiSummaryShort ? (
                  <div className="glass-info mb-4 rounded-xl p-3 text-sm">
                    <p className="font-semibold">KI-Zusammenfassung</p>
                    <p>{selectedEmail.aiSummaryShort}</p>
                    {selectedEmail.aiSummaryLong ? (
                      <p className="mt-1 text-xs opacity-80">{selectedEmail.aiSummaryLong}</p>
                    ) : null}
                    <p className="mt-1 text-xs opacity-80">
                      Kategorie: {selectedEmail.aiCategory ?? "unknown"} | Priorität:{" "}
                      {selectedEmail.aiPriority ?? "normal"}
                    </p>
                  </div>
                ) : null}

                {(selectedEmail.attachments?.length ?? 0) > 0 ? (
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold glass-text-primary">Anhänge</h3>
                    <ul className="mt-2 space-y-2">
                      {selectedEmail.attachments.map((attachment) => {
                        const previewUrl = `/api/emails/${selectedEmail.id}/attachments/${attachment.id}/preview`;
                        const downloadUrl = `${previewUrl}?download=1`;
                        return (
                          <li
                            key={attachment.id}
                            className="glass relative rounded-xl p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="break-all font-medium glass-text-primary">
                                  📎 {getAttachmentDisplayName(attachment)}
                                </span>
                                <p className="text-xs glass-text-tertiary">
                                  {attachment.mimeType || "unbekannt"} ·{" "}
                                  {attachment.size ?? 0} Bytes
                                </p>
                                <p className="text-xs glass-text-tertiary">
                                  Status:{" "}
                                  {attachment.saveStatus === "saved"
                                    ? "in Cloud gespeichert"
                                    : attachment.saveStatus === "error"
                                      ? "Cloud-Fehler"
                                      : "nicht in Cloud gespeichert"}
                                  {attachment.cloudPath
                                    ? ` · Ziel: ${attachment.cloudPath}`
                                    : ""}
                                </p>
                                {attachment.saveError ? (
                                  <p className="text-xs text-red-600">{attachment.saveError}</p>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {getAttachmentPreviewType(attachment) && (
                                  <button
                                    onClick={() => setAttachmentPreviewOpen((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(attachment.id)) next.delete(attachment.id);
                                      else next.add(attachment.id);
                                      return next;
                                    })}
                                    className="glass-btn rounded-lg px-2 py-1 text-xs"
                                  >
                                    {attachmentPreviewOpen.has(attachment.id) ? "Vorschau schließen" : "Vorschau"}
                                  </button>
                                )}
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="glass-btn rounded-lg px-2 py-1 text-xs"
                                >
                                  Öffnen
                                </a>
                                <a
                                  href={downloadUrl}
                                  className="glass-btn rounded-lg px-2 py-1 text-xs"
                                >
                                  Herunterladen
                                </a>
                                <button
                                  onClick={() => {
                                    const w = window.open(previewUrl, "_blank");
                                    if (w) {
                                      w.addEventListener("load", () => {
                                        try {
                                          w.print();
                                        } catch {
                                          // ignore — some MIME types can't be printed inline
                                        }
                                      });
                                    }
                                  }}
                                  className="glass-btn rounded-lg px-2 py-1 text-xs"
                                >
                                  Drucken
                                </button>
                              </div>
                            </div>
                            {attachmentPreviewOpen.has(attachment.id) && getAttachmentPreviewType(attachment) && (
                              <div className="mt-2 overflow-hidden rounded-lg border glass-divider">
                                {getAttachmentPreviewType(attachment) === "image" ? (
                                  <img
                                    src={previewUrl}
                                    alt={getAttachmentDisplayName(attachment)}
                                    className="max-h-[400px] w-full object-contain bg-gray-50"
                                  />
                                ) : (
                                  <iframe
                                    src={previewUrl}
                                    title={getAttachmentDisplayName(attachment)}
                                    className="h-[500px] w-full"
                                  />
                                )}
                              </div>
                            )}

                            <div className="mt-2 flex flex-wrap gap-2 border-t border-gray-100 pt-2">
                              <select
                                value={getAttachmentTarget(attachment.id).provider}
                                onChange={(e) =>
                                  updateAttachmentTarget(attachment.id, {
                                    provider: e.target.value as
                                      | "google_drive"
                                      | "onedrive"
                                      | "mock",
                                  })
                                }
                                className="glass-btn rounded-lg px-2 py-1 text-xs"
                              >
                                <option value="google_drive">Google Drive</option>
                                <option value="onedrive">OneDrive</option>
                              </select>
                              <input
                                value={getAttachmentTarget(attachment.id).targetPath}
                                onChange={(e) =>
                                  updateAttachmentTarget(attachment.id, {
                                    targetPath: e.target.value,
                                  })
                                }
                                className="glass-select min-w-[180px] flex-1 rounded-lg px-2 py-1 text-xs"
                              />
                              <button
                                onClick={() => saveAttachmentToCloud(attachment.id)}
                                className="glass-btn rounded-lg px-2 py-1 text-xs"
                              >
                                In Cloud speichern
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {isLoadingBody ? (
                  <div className="glass rounded-xl p-4 text-sm glass-text-secondary animate-pulse">
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Lade Mailinhalt vom IMAP-Server…
                    </div>
                  </div>
                ) : bodyError ? (
                  <div className="glass-error rounded-xl p-4 text-sm">
                    {bodyError}
                    <button
                      onClick={() => selectedEmail && void loadBody(selectedEmail.id, true)}
                      className="ml-2 underline font-medium"
                    >
                      Erneut versuchen
                    </button>
                  </div>
                ) : bodyContent &&
                  bodyMode === "html" &&
                  bodyContent.html ? (
                  <div className="flex w-full flex-1 flex-col">
                    {!showExternalImages ? (
                      <div className="glass-info rounded-xl px-3 py-2 text-xs mb-2 flex items-center justify-between shrink-0">
                        <span className="glass-text-secondary">Externe Bilder wurden aus Sicherheitsgründen blockiert.</span>
                        <button
                          onClick={() => setShowExternalImages(true)}
                          className="glass-btn rounded-lg px-3 py-1 text-xs shrink-0 ml-2"
                        >
                          Bilder laden
                        </button>
                      </div>
                    ) : null}
                    <iframe
                      ref={mailBodyIframeRef}
                      title="Mailinhalt"
                      sandbox="allow-scripts"
                      srcDoc={safeMailDocument}
                      referrerPolicy="no-referrer"
                      className="block w-full rounded-xl glass lg:flex-1"
                      style={{ border: "none", maxWidth: "100%", minHeight: "80dvh", overflowX: "hidden" }}
                    />
                  </div>
                ) : (
                  <div>
                    {!bodyContent ? (
                      <div className="glass-info rounded-xl p-4 text-sm mb-3 flex items-center gap-3">
                        <svg className="h-5 w-5 shrink-0 glass-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                        <div className="flex-1">
                          <p className="font-medium glass-text-primary text-sm">Mailinhalt wird geladen…</p>
                          <p className="glass-text-muted text-xs mt-0.5">Der vollständige Inhalt wird vom IMAP-Server abgerufen.</p>
                        </div>
                        <button
                          onClick={() => selectedEmail && void loadBody(selectedEmail.id, true)}
                          className="glass-btn rounded-lg px-3 py-1.5 text-xs shrink-0"
                        >
                          Neu laden
                        </button>
                      </div>
                    ) : bodyContent.text && !bodyContent.html ? (
                      <div className="glass-info rounded-xl px-3 py-2 text-xs mb-2 flex items-center gap-2">
                        <span className="glass-text-secondary">Nur Text-Version verfügbar.</span>
                        <button
                          onClick={() => selectedEmail && void loadBody(selectedEmail.id, true)}
                          className="glass-btn rounded-lg px-3 py-1 text-xs"
                        >
                          HTML-Version laden
                        </button>
                      </div>
                    ) : null}
                    <div
                      className="glass flex-1 max-w-full whitespace-pre-wrap break-words rounded-xl p-4 text-sm leading-relaxed glass-text-secondary"
                      style={{ minHeight: "400px" }}
                    >
                      {(() => {
                        const plain =
                          bodyContent?.text ||
                          selectedEmail.textPreview ||
                          selectedEmail.snippet ||
                          "";
                        return plain
                          ? linkifyMailPlainText(plain)
                          : "(Kein Mailinhalt verfügbar.)";
                      })()}
                    </div>
                  </div>
                )}

                {selectedEmailCandidates.length > 0 ? (
                  <div className="glass mt-4 rounded-xl p-3 text-sm">
                    <p className="font-semibold glass-text-primary">Kontaktvorschläge</p>
                    <ul className="mt-1 space-y-1 text-xs glass-text-secondary">
                      {selectedEmailCandidates.map((candidate) => (
                        <li key={candidate.id}>
                          {candidate.personName || candidate.email || "Unbekannt"} ({candidate.status})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="glass-solid fixed inset-x-0 bottom-0 z-20 border-t glass-divider px-3 py-2 lg:hidden">
                {mobileMovePanelOpen ? (
                  <div className="mb-2 rounded-xl border border-white/25 bg-white/55 p-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold glass-text-primary">Verschieben</p>
                      <button
                        type="button"
                        onClick={() => setMobileMovePanelOpen(false)}
                        className="glass-btn rounded-lg px-2 py-1 text-xs"
                      >
                        Schließen
                      </button>
                    </div>
                    <select
                      value={moveTargetFolder}
                      onChange={(e) => setMoveTargetFolder(e.target.value)}
                      className="glass-select mt-2 w-full rounded-lg px-2 py-1.5 text-xs"
                    >
                      <option value="">Vorhandenen Ordner wählen…</option>
                      {folders.map((folder) => (
                        <option key={folder.path} value={folder.path}>
                          {folder.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void moveToSelectedFolder()}
                      disabled={!moveTargetFolder}
                      className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
                    >
                      In ausgewählten Ordner verschieben
                    </button>
                    <div className="mt-2 rounded-lg border border-white/30 p-2">
                      <p className="text-[11px] font-medium glass-text-secondary">Neuen Ordner erstellen</p>
                      <input
                        value={mobileNewFolderName}
                        onChange={(e) => setMobileNewFolderName(e.target.value)}
                        placeholder="Neuer Ordnername"
                        className="glass-input mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
                      />
                      <select
                        value={mobileNewFolderParentPath}
                        onChange={(e) => setMobileNewFolderParentPath(e.target.value)}
                        className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
                      >
                        <option value="">Kein Parent (Root)</option>
                        {mobileNewFolderParentOptions.map((path) => (
                          <option key={path} value={path}>
                            {path}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void createMobileMoveFolder()}
                        disabled={!mobileNewFolderName.trim() || isManagingFolder}
                        className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs disabled:opacity-50"
                      >
                        Ordner anlegen
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-5 gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileMovePanelOpen((v) => !v)}
                    className="glass-btn rounded-lg p-2"
                    aria-label="Verschieben"
                    title="Verschieben"
                  >
                    ↕
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(`/api/emails/${selectedEmail.id}/move`, {
                        targetSpecial: "trash",
                      })
                    }
                    className="glass-btn rounded-lg p-2"
                    aria-label="Papierkorb"
                    title="Papierkorb"
                  >
                    🗑
                  </button>
                  <button
                    type="button"
                    onClick={replyToSelected}
                    className="glass-btn rounded-lg p-2"
                    aria-label="Antworten"
                    title="Antworten"
                  >
                    ↩
                  </button>
                  <button
                    type="button"
                    onClick={replyAllSelected}
                    className="glass-btn rounded-lg p-2"
                    aria-label="Allen antworten"
                    title="Allen antworten"
                  >
                    ⇄
                  </button>
                  <button
                    type="button"
                    onClick={forwardSelected}
                    className="glass-btn rounded-lg p-2"
                    aria-label="Weiterleiten"
                    title="Weiterleiten"
                  >
                    ↪
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm glass-text-muted">
              Keine E-Mail ausgewählt.
            </div>
          )}
        </section>
      </div>

      {mailContextMenu && contextMenuEmail ? (
        <div className="fixed inset-0 z-40" onClick={closeMailContextMenu}>
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className="glass-solid fixed z-50 w-[320px] rounded-xl p-2"
            style={{
              left: Math.max(8, Math.min(mailContextMenu.x, window.innerWidth - 328)),
              top: Math.max(8, Math.min(mailContextMenu.y, window.innerHeight - 420)),
            }}
          >
            <p className="border-b glass-divider px-2 pb-1 text-xs glass-text-muted">
              {contextMenuIsBulk
                ? `${contextMenuTargetIds.length} Mails ausgewählt`
                : senderDisplayName(contextMenuEmail)}
            </p>
            {!contextMenuIsBulk ? (
              <>
                <button
                  className="mt-1 block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                  onClick={() => {
                    openCompose("reply", contextMenuEmail);
                    closeMailContextMenu();
                  }}
                >
                  Antworten
                </button>
                <button
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                  onClick={() => {
                    openCompose("forward", contextMenuEmail);
                    closeMailContextMenu();
                  }}
                >
                  Weiterleiten
                </button>
                <button
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                  onClick={() => {
                    window.open(`/api/emails/${contextMenuEmail.id}/print`, "_blank");
                    closeMailContextMenu();
                  }}
                >
                  Mail drucken
                </button>
              </>
            ) : null}

            <div className="my-1 border-t border-gray-100" />

            <button
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              onClick={() => {
                if (contextMenuIsBulk) {
                  void runBulk("mark_read", undefined, contextMenuTargetIds);
                } else {
                  void runActionForEmail(contextMenuEmail.id, `/api/emails/${contextMenuEmail.id}/mark-read`);
                }
                closeMailContextMenu();
              }}
            >
              Als gelesen markieren
            </button>
            <button
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              onClick={() => {
                if (contextMenuIsBulk) {
                  void runBulk("mark_unread", undefined, contextMenuTargetIds);
                } else {
                  void runActionForEmail(contextMenuEmail.id, `/api/emails/${contextMenuEmail.id}/mark-unread`);
                }
                closeMailContextMenu();
              }}
            >
              Als ungelesen markieren
            </button>

            <div className="my-1 border-t border-gray-100" />

            <button
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              onClick={() => {
                if (contextMenuIsBulk) {
                  void runBulk("move_trash", undefined, contextMenuTargetIds);
                } else {
                  void runActionForEmail(contextMenuEmail.id, `/api/emails/${contextMenuEmail.id}/move`, {
                    targetSpecial: "trash",
                  });
                }
                closeMailContextMenu();
              }}
            >
              In den Papierkorb
            </button>
            {!contextMenuIsBulk ? (
              <button
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                onClick={() => {
                  void markAsSpamAndLearn(contextMenuEmail);
                  closeMailContextMenu();
                }}
              >
                Als Spam lernen (Absender + Inhalt)
              </button>
            ) : (
              <button
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                onClick={() => {
                  void runBulk("move_spam", undefined, contextMenuTargetIds);
                  closeMailContextMenu();
                }}
              >
                In Spam verschieben
              </button>
            )}

            <button
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              onClick={() => {
                void copyEmailsToClipboard(contextMenuTargetIds);
                closeMailContextMenu();
              }}
            >
              Kopieren
            </button>

            <div className="my-1 border-t border-gray-100 pt-1">
              <p className="px-2 text-xs glass-text-muted">Verschieben in Ordner</p>
              <div className="mt-1 flex gap-1 px-1">
                <select
                  value={contextMoveTargetFolder}
                  onChange={(e) => setContextMoveTargetFolder(e.target.value)}
                  className="glass-select w-full rounded-lg px-2 py-1 text-xs"
                >
                  <option value="">Ordner wählen…</option>
                  {folders.map((folder) => (
                    <option key={folder.path} value={folder.path}>
                      {folder.displayName}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!contextMoveTargetFolder}
                  className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  onClick={() => {
                    if (!contextMoveTargetFolder) return;
                    if (contextMenuIsBulk) {
                      void runBulk(
                        "move_folder",
                        { targetFolder: contextMoveTargetFolder },
                        contextMenuTargetIds,
                      );
                    } else {
                      void runActionForEmail(contextMenuEmail.id, `/api/emails/${contextMenuEmail.id}/move`, {
                        targetFolder: contextMoveTargetFolder,
                      });
                    }
                    closeMailContextMenu();
                  }}
                >
                  Verschieben
                </button>
              </div>
            </div>

            {!contextMenuIsBulk && contextMenuAttachments.length > 0 ? (
              <div className="my-1 border-t border-gray-100 pt-1">
                <p className="px-2 text-xs glass-text-muted">Anhänge</p>
                <div className="mt-1 px-1">
                  <select
                    value={selectedContextAttachment?.id ?? ""}
                    onChange={(e) => setContextAttachmentId(e.target.value)}
                    className="glass-select w-full rounded-lg px-2 py-1 text-xs"
                  >
                    {contextMenuAttachments.map((attachment) => (
                      <option key={attachment.id} value={attachment.id}>
                        {getAttachmentDisplayName(attachment)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 px-1">
                  <button
                    disabled={!selectedContextAttachment}
                    className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => {
                      if (!selectedContextAttachment) return;
                      openAttachment(contextMenuEmail.id, selectedContextAttachment.id);
                      closeMailContextMenu();
                    }}
                  >
                    Öffnen
                  </button>
                  <button
                    disabled={!selectedContextAttachment}
                    className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => {
                      if (!selectedContextAttachment) return;
                      printAttachment(contextMenuEmail.id, selectedContextAttachment.id);
                      closeMailContextMenu();
                    }}
                  >
                    Drucken
                  </button>
                  <button
                    disabled={!selectedContextAttachment}
                    className="glass-btn rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => {
                      if (!selectedContextAttachment) return;
                      void saveAttachmentToCloudForEmail(contextMenuEmail.id, selectedContextAttachment.id);
                      closeMailContextMenu();
                    }}
                  >
                    Speichern
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 px-1">
                  <button
                    className="glass-btn rounded-lg px-2 py-1 text-xs"
                    onClick={() => {
                      contextMenuAttachments.forEach((attachment) =>
                        openAttachment(contextMenuEmail.id, attachment.id),
                      );
                      closeMailContextMenu();
                    }}
                  >
                    Alle öffnen
                  </button>
                  <button
                    className="glass-btn rounded-lg px-2 py-1 text-xs"
                    onClick={() => {
                      contextMenuAttachments.forEach((attachment) =>
                        printAttachment(contextMenuEmail.id, attachment.id),
                      );
                      closeMailContextMenu();
                    }}
                  >
                    Alle drucken
                  </button>
                  <button
                    className="glass-btn rounded-lg px-2 py-1 text-xs"
                    onClick={() => {
                      void (async () => {
                        for (const attachment of contextMenuAttachments) {
                          await saveAttachmentToCloudForEmail(contextMenuEmail.id, attachment.id);
                        }
                      })();
                      closeMailContextMenu();
                    }}
                  >
                    Alle speichern
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {composeOpen ? (
        <div className="glass-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="glass-modal flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl">
            <div className="flex items-center justify-between border-b glass-divider px-4 py-3">
              <h3 className="text-base font-semibold glass-text-primary">
                {composeMode === "new"
                  ? "Neue Mail"
                  : composeMode === "reply"
                    ? "Antwort verfassen"
                    : "Weiterleiten"}
              </h3>
              <button
                className="glass-btn rounded-lg px-3 py-1 text-sm"
                onClick={() => setComposeOpen(false)}
              >
                Abbrechen
              </button>
            </div>

            <div className="space-y-2 border-b glass-divider px-4 py-3 text-sm">
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="glass-text-secondary">Konto</label>
                <select
                  value={composeForm.accountId}
                  onChange={(e) =>
                    setComposeForm((prev) => ({ ...prev, accountId: e.target.value }))
                  }
                  className="glass-select rounded-lg px-2 py-1.5"
                >
                  <option value="">Konto wählen...</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.imapUsername})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="glass-text-secondary">An</label>
                <input
                  value={composeForm.to}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, to: e.target.value }))}
                  placeholder="max@firma.de; team@firma.de"
                  className="glass-input rounded-lg px-2 py-1.5"
                  dir="ltr"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="glass-text-secondary">CC</label>
                <input
                  value={composeForm.cc}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, cc: e.target.value }))}
                  className="glass-input rounded-lg px-2 py-1.5"
                  dir="ltr"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="glass-text-secondary">BCC</label>
                <input
                  value={composeForm.bcc}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, bcc: e.target.value }))}
                  className="glass-input rounded-lg px-2 py-1.5"
                  dir="ltr"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="glass-text-secondary">Betreff</label>
                <input
                  value={composeForm.subject}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, subject: e.target.value }))}
                  className="glass-input rounded-lg px-2 py-1.5"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1 border-b glass-divider px-4 py-2 text-xs">
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("bold")}>Fett</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("italic")}>Kursiv</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("underline")}>Unterstr.</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("insertUnorderedList")}>Liste</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("insertOrderedList")}>1.</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("formatBlock", "blockquote")}>Zitat</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("insertHorizontalRule")}>Linie</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("insertText", "✎")}>Zeichen ✎</button>
              <button className="glass-btn rounded-lg px-2 py-1" onClick={() => applyComposeCommand("insertText", "✓")}>Zeichen ✓</button>
              <input
                type="color"
                className="glass-input h-7 w-10 rounded-lg"
                onChange={(e) => applyComposeCommand("foreColor", e.target.value)}
                title="Textfarbe"
              />
              <button
                className="glass-btn ml-auto rounded-lg px-2 py-1"
                onClick={() => {
                  const signature = insertSignatureHtml(composeMode, composeForm.accountId);
                  if (!signature) return;
                  applyComposeCommand("insertHTML", signature);
                }}
              >
                Signatur einfügen
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div
                ref={composeEditorRef}
                contentEditable
                suppressContentEditableWarning
                dir="ltr"
                onInput={() =>
                  setComposeForm((prev) => ({
                    ...prev,
                    bodyHtml: composeEditorRef.current?.innerHTML || "",
                  }))
                }
                className="glass-input min-h-[260px] rounded-xl p-3 text-sm"
                style={{ direction: "ltr", textAlign: "left" }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t glass-divider px-4 py-3 text-sm">
              <input
                type="datetime-local"
                value={composeForm.sendAtLocal}
                onChange={(e) => setComposeForm((prev) => ({ ...prev, sendAtLocal: e.target.value }))}
                className="glass-input rounded-lg px-2 py-1.5"
                title="Später senden"
              />
              <button
                disabled={composeSaving}
                onClick={() => void submitCompose("send_later")}
                className="glass-btn rounded-lg px-3 py-1.5 disabled:opacity-60"
              >
                Später senden
              </button>
              <button
                disabled={composeSaving}
                onClick={() => void submitCompose("save_draft")}
                className="glass-btn rounded-lg px-3 py-1.5 disabled:opacity-60"
              >
                Als Entwurf speichern
              </button>
              <button
                disabled={composeSaving}
                onClick={() => void submitCompose("send_now")}
                className="glass-btn-primary ml-auto rounded-lg px-3 py-1.5 disabled:opacity-60"
              >
                Jetzt senden
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {emptyFolderModalOpen && folderEmptyKind ? (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !bulkBusy && setEmptyFolderModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="glass-modal w-full max-w-md rounded-2xl p-5"
          >
            <h3 className="text-base font-semibold glass-text-primary">
              {folderEmptyKind === "trash" ? "Papierkorb leeren?" : "Spam leeren?"}
            </h3>
            <p className="mt-2 text-sm glass-text-secondary">
              Diese Aktion löscht alle E-Mails im Ordner{" "}
              <span className="font-mono">{selectedFolderPath}</span>{" "}
              <strong>endgültig</strong> und kann nicht rückgängig gemacht werden.
            </p>
            <p className="mt-2 text-xs glass-text-tertiary">
              Tippe zur Bestätigung <span className="font-mono font-semibold">LEEREN</span>{" "}
              ein:
            </p>
            <input
              autoFocus
              value={emptyConfirmText}
              onChange={(e) => setEmptyConfirmText(e.target.value)}
              placeholder="LEEREN"
              className="glass-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                disabled={bulkBusy}
                onClick={() => {
                  setEmptyFolderModalOpen(false);
                  setEmptyConfirmText("");
                }}
                className="glass-btn rounded-lg px-3 py-1.5 text-sm"
              >
                Abbrechen
              </button>
              <button
                disabled={bulkBusy || emptyConfirmText !== "LEEREN"}
                onClick={() => void emptyCurrentFolder()}
                className="rounded-lg bg-red-500/80 px-3 py-1.5 text-sm text-white backdrop-blur-sm disabled:opacity-50"
              >
                {bulkBusy ? "Leere…" : "Endgültig leeren"}
              </button>
            </div>
          </div>
        </div>
      ) : null}


      {isBodyMaximized && selectedEmail && bodyContent ? (
        <div
          className="glass-overlay fixed inset-0 z-50 flex"
          onClick={() => setIsBodyMaximized(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-modal m-auto flex h-full w-full flex-col md:h-[90vh] md:w-[90vw] md:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Mailinhalt vergrößert"
          >
            <header className="flex shrink-0 items-center gap-2 border-b glass-divider px-3 py-2 md:px-4">
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold glass-text-primary md:text-lg">
                {selectedEmail.subject || "(Ohne Betreff)"}
              </h2>
              <div className="relative shrink-0" data-max-body-menu-root>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMaximizedBodyMenuOpen((v) => !v);
                  }}
                  aria-label="Ansicht und Druck"
                  aria-expanded={maximizedBodyMenuOpen}
                  className="glass-btn flex h-10 w-10 items-center justify-center rounded-lg"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-5 w-5"
                    aria-hidden
                  >
                    <circle cx="12" cy="5" r="1.75" />
                    <circle cx="12" cy="12" r="1.75" />
                    <circle cx="12" cy="19" r="1.75" />
                  </svg>
                </button>
                {maximizedBodyMenuOpen ? (
                  <div
                    role="menu"
                    className="glass-solid absolute right-0 z-10 mt-1 w-56 rounded-xl py-2 text-sm"
                  >
                    {bodyContent.html && bodyContent.text ? (
                      <div className="border-b glass-divider px-3 py-2">
                        <p className="text-xs font-semibold glass-text-muted">Ansicht</p>
                        <div className="mt-1 flex gap-1">
                          <button
                            type="button"
                            onClick={() => setBodyMode("text")}
                            className={`flex-1 rounded-lg px-2 py-1 text-xs ${
                              bodyMode === "text"
                                ? "glass-btn-dark"
                                : "glass-btn"
                            }`}
                          >
                            Text
                          </button>
                          <button
                            type="button"
                            onClick={() => setBodyMode("html")}
                            className={`flex-1 rounded-lg px-2 py-1 text-xs ${
                              bodyMode === "html"
                                ? "glass-btn-dark"
                                : "glass-btn"
                            }`}
                          >
                            HTML
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="px-3 py-2">
                      <p className="text-xs font-semibold glass-text-muted">Druck</p>
                      <select
                        value={printMode}
                        onChange={(e) => setPrintMode(e.target.value as "html" | "text")}
                        className="glass-select mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
                        title="Druckmodus"
                      >
                        <option value="html">Druck: HTML</option>
                        <option value="text">Druck: Text</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          setMaximizedBodyMenuOpen(false);
                          printSelectedEmail();
                        }}
                        className="glass-btn mt-2 w-full rounded-lg px-2 py-1.5 text-xs"
                      >
                        Drucken
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setMaximizedBodyMenuOpen(false);
                  setIsBodyMaximized(false);
                }}
                aria-label="Schließen"
                className="glass-btn shrink-0 rounded-lg px-3 py-2 text-sm"
              >
                ✕
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:p-4">
              {bodyMode === "html" && bodyContent.html ? (
                <div className="w-full h-full flex flex-col">
                  {!showExternalImages ? (
                    <div className="glass-info rounded-xl px-3 py-2 text-xs mb-2 flex items-center justify-between shrink-0">
                      <span className="glass-text-secondary">Externe Bilder blockiert.</span>
                      <button
                        onClick={() => setShowExternalImages(true)}
                        className="glass-btn rounded-lg px-3 py-1 text-xs shrink-0 ml-2"
                      >
                        Bilder laden
                      </button>
                    </div>
                  ) : null}
                  <iframe
                    ref={mailBodyIframeRef}
                    title="Mailinhalt vergrößert"
                    sandbox="allow-scripts"
                    srcDoc={safeMailDocument}
                    referrerPolicy="no-referrer"
                    className="block w-full flex-1 min-h-[60vh] rounded-xl glass"
                    style={{ border: "none", maxWidth: "100%", overflow: "hidden" }}
                  />
                </div>
              ) : (
                <div className="glass min-h-[50vh] whitespace-pre-wrap rounded-xl p-4 text-sm leading-relaxed glass-text-secondary">
                  {(() => {
                    const plain =
                      bodyContent.text ||
                      selectedEmail.textPreview ||
                      selectedEmail.snippet ||
                      "";
                    return plain
                      ? linkifyMailPlainText(plain)
                      : "(Kein Mailinhalt verfügbar.)";
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pendingLinkUrl ? (
        <div
          className="glass-overlay fixed inset-0 z-[9999] flex items-center justify-center"
          onClick={() => setPendingLinkUrl(null)}
        >
          <div
            className="glass-card mx-4 w-full max-w-lg rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold glass-text-primary">
              Externen Link öffnen?
            </h3>
            <p className="mb-2 text-sm glass-text-secondary">
              Möchtest du diesen Link in einem neuen Tab öffnen?
            </p>
            <div className="mb-5 rounded-lg bg-black/5 p-3 break-all text-xs font-mono glass-text-primary">
              {pendingLinkUrl}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingLinkUrl(null)}
                className="glass-btn rounded-lg px-4 py-2 text-sm"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => {
                  window.open(pendingLinkUrl, "_blank", "noopener,noreferrer");
                  setPendingLinkUrl(null);
                }}
                className="glass-btn-primary rounded-lg px-4 py-2 text-sm"
              >
                Link öffnen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {popupEmailId ? (
        <EmailDetailModal
          emailId={popupEmailId}
          onClose={() => setPopupEmailId(null)}
          onAction={() => {
            void loadEmails();
          }}
        />
      ) : null}
    </div>
  );
}
