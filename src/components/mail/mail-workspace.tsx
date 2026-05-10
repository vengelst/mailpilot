"use client";

import {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { buildSafeMailDocument } from "@/lib/sanitizeMailHtml";
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
      className="hidden w-1 shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-blue-400 active:bg-blue-500 lg:block"
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
};

type Folder = {
  path: string;
  displayName: string;
  delimiter?: string | null;
  specialUse?: string;
  unreadCount?: number;
  totalCount?: number;
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
};

function FolderTreeRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedPath,
  onSelect,
}: FolderTreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const isActive = node.folder?.path === selectedPath;
  const unread = node.folder?.unreadCount ?? 0;
  const total = node.folder?.totalCount ?? 0;
  const selectable = !!node.folder;
  const indent = depth * 12;

  return (
    <li>
      <div
        className={`flex items-center gap-1 pr-2 ${
          isActive ? "bg-gray-900 text-white" : unread > 0 ? "text-gray-900" : "text-gray-700"
        }`}
        style={{ paddingLeft: indent }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.path)}
            aria-label={isExpanded ? "Einklappen" : "Ausklappen"}
            className={`flex h-6 w-5 shrink-0 items-center justify-center text-[10px] ${
              isActive ? "text-gray-200 hover:text-white" : "text-gray-400 hover:text-gray-700"
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
            !isActive && selectable ? "hover:bg-gray-100" : ""
          } ${!isActive && !selectable ? "italic text-gray-500 hover:bg-gray-50" : ""}`}
          title={node.path}
        >
          <span className="truncate">{node.segment}</span>
          {selectable ? (
            <span
              className={`shrink-0 text-xs tabular-nums ${
                isActive ? "text-gray-200" : "text-gray-500"
              }`}
            >
              {unread > 0 ? `${unread}/${total}` : total > 0 ? total : ""}
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
  aiSummaryShort: string | null;
  aiSummaryLong?: string | null;
  aiCategory: string | null;
  aiPriority: string | null;
  actionRequired?: boolean;
  attachments: Attachment[];
};

type MailContextMenuState = {
  x: number;
  y: number;
  emailId: string;
  targetIds: string[];
};

type SignatureSettings = {
  signatureText: string;
  includeOnNewMail: boolean;
  includeOnReply: boolean;
  includeOnForward: boolean;
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

type AttachmentHoverPreview = {
  url: string;
  title: string;
  x: number;
  y: number;
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
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingMoreEmails, setIsLoadingMoreEmails] = useState(false);
  const [emailsHasMore, setEmailsHasMore] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<
    | {
        kind: "incremental" | "full" | "all_folders";
        label: string;
      }
    | null
  >(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [hasAttachmentsFilter, setHasAttachmentsFilter] = useState(false);
  const [actionRequiredFilter, setActionRequiredFilter] = useState(false);
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
  const [accountExpanded, setAccountExpanded] = useState(true);
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(new Set());
  const [bodyContent, setBodyContent] = useState<{ text: string; html: string } | null>(null);
  const [isLoadingBody, setIsLoadingBody] = useState(false);
  const [bodyError, setBodyError] = useState("");
  const [bodyMode, setBodyMode] = useState<"text" | "html">("html");
  const [printMode, setPrintMode] = useState<"html" | "text">("html");
  const [isBodyMaximized, setIsBodyMaximized] = useState(false);
  const [hoveredAttachmentPreview, setHoveredAttachmentPreview] =
    useState<AttachmentHoverPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [emptyFolderModalOpen, setEmptyFolderModalOpen] = useState(false);
  const [emptyConfirmText, setEmptyConfirmText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const [newMailCheckIntervalMinutes, setNewMailCheckIntervalMinutes] = useState(30);
  const [mailScrollBatchSize, setMailScrollBatchSize] =
    useState<MailScrollBatchOption>(DEFAULT_MAIL_SCROLL_BATCH);
  const [mailContextMenu, setMailContextMenu] = useState<MailContextMenuState | null>(null);
  const [contextMoveTargetFolder, setContextMoveTargetFolder] = useState("");
  const [contextAttachmentId, setContextAttachmentId] = useState("");
  const [signatureSettings, setSignatureSettings] = useState<SignatureSettings>({
    signatureText: "",
    includeOnNewMail: true,
    includeOnReply: true,
    includeOnForward: true,
  });
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
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreEmailsRef = useRef<() => Promise<void>>(async () => {});
  const emailsNextCursorRef = useRef<string | null>(null);
  const emailsHasMoreRef = useRef(false);
  const isLoadingEmailsRef = useRef(false);

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
    () => (bodyContent?.html ? buildSafeMailDocument(bodyContent.html) : ""),
    [bodyContent],
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

  function clearSelection() {
    setSelectedIds(new Set());
  }
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      setSelectedAccountId(next[0].id);
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
    } else if (!next.some((f) => f.path === selectedFolderPath)) {
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
    const res = await fetch("/api/signature/settings");
    if (!res.ok) return;
    const data = (await res.json()) as { settings?: SignatureSettings };
    if (data.settings) setSignatureSettings(data.settings);
  }

  async function loadAutomationSettings() {
    const res = await fetch("/api/automation/settings");
    if (!res.ok) return;
    const data = (await res.json()) as {
      settings?: { runIntervalMinutes?: number; mailScrollBatchSize?: number };
    };
    const interval = data.settings?.runIntervalMinutes;
    if (typeof interval === "number" && Number.isFinite(interval) && interval >= 5) {
      setNewMailCheckIntervalMinutes(interval);
    }
    const batch = data.settings?.mailScrollBatchSize;
    if (typeof batch === "number" && Number.isFinite(batch)) {
      setMailScrollBatchSize(snapMailScrollBatchSize(batch));
    }
  }

  function mailListSearchParams(cursor: string | null) {
    const params = new URLSearchParams({
      accountId: selectedAccountId,
      folder: selectedFolderPath,
      sort,
      limit: String(mailScrollBatchSize),
    });
    if (query.trim()) params.set("q", query.trim());
    if (hasAttachmentsFilter) params.set("hasAttachments", "true");
    if (actionRequiredFilter) params.set("actionRequired", "true");
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
    if (!selectedAccountId || !selectedFolderPath) return;
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

  loadMoreEmailsRef.current = loadMoreEmails;

  async function loadEmails() {
    if (!selectedAccountId || !selectedFolderPath) {
      setEmails([]);
      setSelectedEmail(null);
      emailsNextCursorRef.current = null;
      emailsHasMoreRef.current = false;
      setEmailsHasMore(false);
      return [] as Email[];
    }
    isLoadingEmailsRef.current = true;
    setIsLoadingEmails(true);
    setUiError("");
    emailsNextCursorRef.current = null;
    emailsHasMoreRef.current = false;
    setEmailsHasMore(false);

    const res = await fetch(`/api/search?${mailListSearchParams(null).toString()}`);
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
      setMobileView("list");
      setEmailDetailMenuOpen(false);
    }
    isLoadingEmailsRef.current = false;
    setIsLoadingEmails(false);
    return nextEmails;
  }

  async function loadEmail(id: string) {
    setIsLoadingDetail(true);
    setEmailDetailMenuOpen(false);
    setHoveredAttachmentPreview(null);
    setBodyContent(null);
    setBodyError("");
    setBodyMode("html");
    setIsBodyMaximized(false);
    const res = await fetch(`/api/emails/${id}`);
    if (!res.ok) {
      setUiError("E-Mail konnte nicht geladen werden.");
      setSelectedEmail(null);
      setEmailDetailMenuOpen(false);
      setIsLoadingDetail(false);
      return;
    }
    const data = await res.json();
    setSelectedEmail(data.email ?? null);
    setMobileView("detail");
    setIsLoadingDetail(false);
    await loadContactCandidates();
    await loadBody(id);
  }

  async function loadBody(id: string) {
    setIsLoadingBody(true);
    setBodyError("");
    try {
      const res = await fetch(`/api/emails/${id}/body`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBodyError(
          (data as { error?: string }).error ?? "Mailinhalt konnte nicht geladen werden.",
        );
        setBodyContent(null);
        return;
      }
      const data = (await res.json()) as {
        body?: { text?: string; html?: string; textFromHtml?: string };
      };
      const text = data.body?.text || data.body?.textFromHtml || "";
      const html = data.body?.html || "";
      setBodyContent({ text, html });
      setBodyMode(html ? "html" : text ? "text" : "text");
    } catch (error) {
      setBodyError(error instanceof Error ? error.message : "Mailinhalt konnte nicht geladen werden.");
      setBodyContent(null);
    } finally {
      setIsLoadingBody(false);
    }
  }

  async function reloadFolders() {
    if (selectedAccountId) await loadFolders(selectedAccountId);
  }

  async function syncAllFolders() {
    if (!selectedAccountId) return;
    if (
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
        label: "Synchronisiere alle Ordner …",
      });
      setUiInfo("");
      setUiError("");
      const res = await fetch(`/api/accounts/${selectedAccountId}/sync-all-folders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "incremental" }),
      });
      if (!res.ok) {
        setUiError(await readErrorMessage(res, "Alle-Ordner-Sync fehlgeschlagen."));
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
      setUiInfo(
        `Alle-Ordner-Sync: ${data.folderCount} Ordner verarbeitet` +
          (skipped > 0 ? `, ${skipped} übersprungen` : "") +
          `, ${data.totalNew} neue Mails, ${data.totalFlagsUpdated} Flag-Änderungen` +
          (data.totalRemoved > 0 ? `, ${data.totalRemoved} aus Index entfernt` : "") +
          ".",
      );
      await loadEmails();
      await reloadFolders();
    } finally {
      setSyncProgress(null);
      setIsSyncing(false);
    }
  }

  async function syncCurrentFolder(
    mode: "incremental" | "full" = "incremental",
    reason: "general" | "attachments" = "general",
  ) {
    if (!selectedAccountId || !selectedFolderPath) return;
    if (
      mode === "full" &&
      !window.confirm(
        reason === "attachments"
          ? "Anhang-Daten werden durch einen Vollsync des aktuellen Ordners neu eingelesen (Dateiname, Dateityp, Part-ID, Größe). Bei großen Ordnern kann das dauern. Fortfahren?"
          : "Vollsync indexiert den gesamten aktuellen Ordner neu vom IMAP-Server. Bei großen Ordnern kann das deutlich länger dauern. Fortfahren?",
      )
    ) {
      return;
    }
    try {
      setIsSyncing(true);
      setSyncProgress({
        kind: mode === "full" ? "full" : "incremental",
        label:
          mode === "full"
            ? "Vollsync des aktuellen Ordners läuft …"
            : "Synchronisiere aktuellen Ordner …",
      });
      setUiInfo("");
      setUiError("");
      const res = await fetch(`/api/accounts/${selectedAccountId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: selectedFolderPath, mode }),
      });
      if (res.status === 409) {
        setUiError(
          "Es läuft bereits eine Synchronisierung für diesen Ordner. Bitte einen Moment warten.",
        );
        return;
      }
      if (!res.ok) {
        setUiError(await readErrorMessage(res, "Synchronisierung fehlgeschlagen."));
        return;
      }
      const data = (await res.json()) as {
        mode: "incremental" | "full";
        newMails: number;
        flagsUpdated: number;
        removedFromIndex?: number;
        uidValidityChanged: boolean;
      };
      const removedSuffix =
        data.removedFromIndex && data.removedFromIndex > 0
          ? `, ${data.removedFromIndex} aus Index entfernt`
          : "";
      const summary =
        data.mode === "full"
          ? `Vollsync: ${data.newMails} Mails komplett neu indiziert.`
          : data.uidValidityChanged
            ? `Inkrementeller Sync: Ordner-UID hat sich geändert, ${data.newMails} Mails neu indiziert.`
            : `Inkrementeller Sync: ${data.newMails} neue Mails, ${data.flagsUpdated} Flag-Änderungen${removedSuffix}.`;
      setUiError("");
      setUiInfo(
        reason === "attachments" && data.mode === "full"
          ? `${summary} Anhang-Metadaten wurden dabei neu eingelesen.`
          : summary,
      );
      await loadEmails();
      await reloadFolders();
      if (selectedEmail?.id) {
        await loadEmail(selectedEmail.id);
      }
    } finally {
      setSyncProgress(null);
      setIsSyncing(false);
    }
  }

  async function checkNow() {
    await syncCurrentFolder("incremental");
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
    if (!selectedAccountId || !selectedFolderPath || !folderEmptyKind) return;
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
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      setUiError(await readErrorMessage(res, "Aktion fehlgeschlagen."));
      return;
    }
    const nextEmails = await loadEmails();
    if (nextEmails.some((email) => email.id === emailId)) {
      await loadEmail(emailId);
    } else {
      setSelectedEmail(null);
      setMobileView("list");
      setEmailDetailMenuOpen(false);
    }
    await reloadFolders();
  }

  async function runAction(path: string, payload?: object) {
    if (!selectedEmail) return;
    await runActionForEmail(selectedEmail.id, path, payload);
  }

  async function moveToSelectedFolder() {
    if (!selectedEmail || !moveTargetFolder) return;
    await runAction(`/api/emails/${selectedEmail.id}/move`, { targetFolder: moveTargetFolder });
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

  function getSignatureFor(mode: "new" | "reply" | "forward") {
    const signature = toMailtoPlainText(signatureSettings.signatureText);
    if (!signature) return "";
    if (mode === "new" && signatureSettings.includeOnNewMail) return signature;
    if (mode === "reply" && signatureSettings.includeOnReply) return signature;
    if (mode === "forward" && signatureSettings.includeOnForward) return signature;
    return "";
  }

  function insertSignatureHtml(mode: ComposeMode) {
    const signature = getSignatureFor(mode);
    if (!signature) return "";
    return `<p><br/></p><p>${plainToHtml(signature)}</p>`;
  }

  function openCompose(mode: ComposeMode, source?: Email) {
    const defaultAccountId = selectedAccountId || accounts[0]?.id || "";
    const quoteText =
      source && mode !== "new"
        ? buildMailtoQuote(
            source,
            mode === "reply" ? "--- Ursprüngliche Nachricht ---" : "--- Weitergeleitete Nachricht ---",
          )
        : "";
    const quoteHtml = quoteText ? `<p>${plainToHtml(quoteText)}</p>` : "";
    const signatureHtml = insertSignatureHtml(mode);
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
      bodyHtml: `${signatureHtml}${quoteHtml}`.trim(),
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

  function updateAttachmentHoverPreview(
    e: ReactMouseEvent<HTMLElement>,
    previewUrl: string,
    attachment: Attachment,
  ) {
    if (typeof window === "undefined" || window.innerWidth < 1024) return;
    const width = 360;
    const height = 240;
    const margin = 12;
    const rawX = e.clientX + 16;
    const rawY = e.clientY - height - 16;
    const x = Math.max(margin, Math.min(rawX, window.innerWidth - width - margin));
    const y = Math.max(margin, Math.min(rawY, window.innerHeight - height - margin));
    setHoveredAttachmentPreview({
      url: previewUrl,
      title: getAttachmentDisplayName(attachment),
      x,
      y,
    });
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
      void fetch("/api/compose/send-due", { method: "POST" });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!selectedAccountId) return;
    const timer = setTimeout(() => {
      void loadFolders(selectedAccountId);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  useEffect(() => {
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
    tab,
    sort,
    mailScrollBatchSize,
  ]);

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

  // Close the sync dropdown on Escape or when clicking elsewhere.
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

  useEffect(() => {
    if (bodyMode !== "html" || !safeMailDocument) return;
    let attached: HTMLIFrameElement | null = null;
    const resize = () => {
      const frame = mailBodyIframeRef.current;
      if (!frame) return;
      try {
        const doc = frame.contentDocument;
        const b = doc?.body;
        const rootEl = doc?.documentElement;
        if (!b || !rootEl) return;
        const h = Math.max(b.scrollHeight, rootEl.scrollHeight, b.offsetHeight);
        frame.style.height = `${Math.min(Math.max(h + 48, 360), 16000)}px`;
      } catch {
        /* ignore */
      }
    };
    const onLoad = () => {
      resize();
      requestAnimationFrame(resize);
      window.setTimeout(resize, 150);
      window.setTimeout(resize, 700);
    };
    const raf = requestAnimationFrame(() => {
      attached = mailBodyIframeRef.current;
      if (!attached) return;
      attached.addEventListener("load", onLoad);
      onLoad();
    });
    return () => {
      cancelAnimationFrame(raf);
      attached?.removeEventListener("load", onLoad);
    };
  }, [safeMailDocument, bodyMode, selectedEmail?.id]);

  useEffect(() => {
    if (!selectedAccountId || !selectedFolderPath) return;
    const intervalMs = Math.max(5, newMailCheckIntervalMinutes) * 60 * 1000;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (isSyncing || autoCheckInFlightRef.current) return;
      autoCheckInFlightRef.current = true;
      void (async () => {
        try {
          const res = await fetch(`/api/accounts/${selectedAccountId}/sync`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ folderPath: selectedFolderPath, mode: "incremental" }),
          });
          if (res.ok) {
            await loadEmails();
            await reloadFolders();
          }
        } finally {
          autoCheckInFlightRef.current = false;
        }
      })();
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, selectedFolderPath, newMailCheckIntervalMinutes, isSyncing]);

  useEffect(() => {
    if (!composeOpen || !composeEditorRef.current) return;
    composeEditorRef.current.innerHTML = composeForm.bodyHtml || "";
  }, [composeOpen, composeForm.bodyHtml]);

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
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-gray-50">
      <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 shadow-sm md:px-4">
        <button
          onClick={() => setFoldersOpen((v) => !v)}
          aria-label={foldersOpen ? "Ordner einklappen" : "Ordner ausklappen"}
          title={foldersOpen ? "Ordner einklappen" : "Ordner ausklappen"}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 hover:bg-gray-50"
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
        <h1 className="text-base font-semibold text-gray-900">MailPilot</h1>

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
            setMobileView("list");
            setEmailDetailMenuOpen(false);
          }}
          className="ml-2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Konto wählen</option>
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
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-gray-700 focus:outline-none"
          />
        </div>

        <div className="relative" data-sync-menu-root>
          <button
            type="button"
            onClick={() => setShowSyncMenu((v) => !v)}
            disabled={isSyncing || !selectedAccountId}
            aria-haspopup="menu"
            aria-expanded={showSyncMenu}
            aria-controls="mailpilot-sync-menu"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            title="Synchronisationsoptionen"
          >
            {isSyncing ? "Synchronisiere..." : "Synchronisieren ▾"}
          </button>
          {showSyncMenu ? (
            <div
              id="mailpilot-sync-menu"
              role="menu"
              className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
            >
              <button
                role="menuitem"
                onClick={() => {
                  setShowSyncMenu(false);
                  void syncCurrentFolder("incremental");
                }}
                disabled={isSyncing || !selectedAccountId || !selectedFolderPath}
                className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="font-medium text-gray-900">
                  Aktuellen Ordner synchronisieren
                </span>
                <span className="block text-xs text-gray-600">
                  Nur neue Mails und Statusänderungen laden
                </span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setShowSyncMenu(false);
                  void syncCurrentFolder("full");
                }}
                disabled={isSyncing || !selectedAccountId || !selectedFolderPath}
                className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="font-medium text-gray-900">
                  Aktuellen Ordner vollständig neu indexieren
                </span>
                <span className="block text-xs text-gray-600">
                  Vollsync — kann länger dauern, fragt vor dem Start nach Bestätigung
                </span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setShowSyncMenu(false);
                  void syncCurrentFolder("full", "attachments");
                }}
                disabled={isSyncing || !selectedAccountId || !selectedFolderPath}
                className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="font-medium text-gray-900">
                  Anhang-Daten neu einlesen (aktueller Ordner)
                </span>
                <span className="block text-xs text-gray-600">
                  Nutzt Vollsync, um Dateiname/Typ/Größe/Part-ID für bestehende Mails zu aktualisieren
                </span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setShowSyncMenu(false);
                  void syncAllFolders();
                }}
                disabled={isSyncing || !selectedAccountId}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="font-medium text-gray-900">
                  Alle Ordner synchronisieren
                </span>
                <span className="block text-xs text-gray-600">
                  Lädt Header und Zähler aller Ordner und Unterordner
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void checkNow()}
          disabled={isSyncing || !selectedAccountId || !selectedFolderPath}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title={`Sofort auf neue Mails pruefen (Intervall: ${newMailCheckIntervalMinutes} Min.)`}
        >
          Check jetzt
        </button>
        <a
          href="/search"
          title="Erweiterte Suche"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          <span className="hidden md:inline">Erweiterte Suche</span>
          <span className="md:hidden">Suche</span>
        </a>
        <a
          href="/ai-assistant"
          title="KI-Assistent"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          ✨ KI
        </a>
        <button
          onClick={composeNewMail}
          title="Neue E-Mail"
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-black"
        >
          Neue Mail
        </button>
        <a
          href="/settings"
          aria-label="Einstellungen"
          title="Einstellungen"
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 hover:bg-gray-50"
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
        <ThemeToggle className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 hover:bg-gray-50" />
        <button
          onClick={logout}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Logout
        </button>
      </header>

      {syncProgress ? (
        <div
          className="border-b border-blue-200 bg-blue-50 px-4 py-1.5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <span className="text-xs text-blue-900">{syncProgress.label}</span>
          </div>
          <div
            className="mt-1 h-1 w-full overflow-hidden rounded-full bg-blue-200"
            role="progressbar"
            aria-label={syncProgress.label}
            aria-valuetext="läuft"
          >
            <div className="mailpilot-progress-bar h-full w-1/3 rounded-full bg-blue-600" />
          </div>
        </div>
      ) : null}

      {uiError ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {uiError}
        </p>
      ) : null}
      {uiInfo ? (
        <p className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          {uiInfo}
        </p>
      ) : null}

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
        style={
          {
            "--mp-folder-w": `${folderWidth}px`,
            "--mp-list-w": `${listWidth}px`,
          } as CSSProperties
        }
      >
        {foldersOpen ? (
          <aside
            className={`flex max-h-[50dvh] min-h-0 shrink-0 flex-col border-r border-gray-200 bg-white lg:max-h-none lg:w-[var(--mp-folder-w)] lg:shrink-0 ${
              mobileView !== "list" ? "hidden lg:flex" : "flex"
            }`}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Ordner
              </span>
              <button
                onClick={() => void reloadFolders()}
                className="text-xs text-gray-500 hover:text-gray-800"
                title="Ordner aktualisieren"
              >
                ↻
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1 text-sm">
              {folders.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-500">
                  {selectedAccountId ? "Lade Ordner..." : "Kein Konto gewählt."}
                </p>
              ) : (
                <ul>
                  <li>
                    <button
                      onClick={() => setAccountExpanded((v) => !v)}
                      className="flex w-full items-center gap-1 px-2 py-1 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100"
                      title={selectedAccount?.name ?? accountRootLabel}
                    >
                      <span className="flex h-6 w-5 shrink-0 items-center justify-center text-[10px] text-gray-500">
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
                            onSelect={(path) => {
                              setSelectedFolderPath(path);
                              setSelectedEmail(null);
                              setBodyContent(null);
                              setMobileView("list");
                              setEmailDetailMenuOpen(false);
                            }}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                </ul>
              )}
            </div>
          </aside>
        ) : null}

        {foldersOpen ? (
          <ResizeHandle onDrag={dragFolder} ariaLabel="Ordnerbreite ändern" />
        ) : null}

        <section
          className={`flex min-h-0 flex-1 flex-col border-r border-gray-200 bg-white lg:flex-none lg:w-[var(--mp-list-w)] lg:shrink-0 ${
            mobileView === "detail" ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="flex items-center gap-3 border-b border-gray-100 px-3 py-2">
            <div className="flex gap-3 text-sm">
              <button
                onClick={() => setTab("all")}
                className={`relative pb-1 ${
                  tab === "all"
                    ? "font-semibold text-gray-900 after:absolute after:inset-x-0 after:-bottom-[5px] after:h-[2px] after:bg-gray-900"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                Alle
              </button>
              <button
                onClick={() => setTab("unread")}
                className={`relative pb-1 ${
                  tab === "unread"
                    ? "font-semibold text-gray-900 after:absolute after:inset-x-0 after:-bottom-[5px] after:h-[2px] after:bg-gray-900"
                    : "text-gray-500 hover:text-gray-800"
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
              className="ml-auto rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
            >
              <option value="date_desc">Neueste</option>
              <option value="date_asc">Älteste</option>
              <option value="from_asc">Absender A-Z</option>
              <option value="subject_asc">Betreff A-Z</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2">
            <label className="flex items-center gap-1 text-xs text-gray-700">
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
              className={`rounded-full border px-2 py-0.5 text-xs ${
                hasAttachmentsFilter
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700"
              }`}
            >
              Mit Anhängen
            </button>
            <button
              onClick={() => setActionRequiredFilter((v) => !v)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                actionRequiredFilter
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700"
              }`}
            >
              Aktion erforderlich
            </button>
            {folderEmptyKind ? (
              <button
                onClick={() => {
                  setEmptyConfirmText("");
                  setEmptyFolderModalOpen(true);
                }}
                className="ml-auto rounded-md border border-red-300 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
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
            <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-2 text-xs">
              <span className="font-medium text-blue-900">
                {selectedIds.size} ausgewählt
              </span>
              <button
                disabled={bulkBusy}
                onClick={() => void runBulk("mark_read")}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
              >
                Gelesen
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => void runBulk("mark_unread")}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
              >
                Ungelesen
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => void runBulk("move_trash")}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
              >
                Papierkorb
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => void runBulk("move_spam")}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
              >
                Spam
              </button>
              <select
                value={moveTargetFolder}
                onChange={(e) => setMoveTargetFolder(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1"
              >
                <option value="">Verschieben nach…</option>
                {folders.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.displayName}
                  </option>
                ))}
              </select>
              <button
                disabled={bulkBusy || !moveTargetFolder}
                onClick={() =>
                  void runBulk("move_folder", { targetFolder: moveTargetFolder })
                }
                className="rounded-md border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
              >
                Verschieben
              </button>
              <button
                onClick={clearSelection}
                className="ml-auto rounded-md border border-gray-300 bg-white px-2 py-1"
              >
                Auswahl aufheben
              </button>
            </div>
          ) : null}

          <div
            ref={listScrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {isLoadingEmails ? (
              <p className="px-4 py-3 text-sm text-gray-600">Lade E-Mails...</p>
            ) : null}
            {!isLoadingEmails && emails.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">
                Keine E-Mails für die aktuellen Filter.
              </p>
            ) : null}
            <ul className="divide-y divide-gray-100">
              {emails.map((email) => {
                const unread = isUnread(email);
                const sender = senderDisplayName(email);
                const seed = email.fromEmail || email.fromName || email.id;
                const isSelected = selectedEmail?.id === email.id;
                const isChecked = selectedIds.has(email.id);
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
                return (
                  <li key={email.id}>
                    <div
                      onContextMenu={(e) => openMailContextMenu(e, email)}
                      className={`flex w-full items-start gap-2 rounded-md border-2 px-2 py-2 text-left transition ${
                        isSelected || isChecked
                          ? "border-4 border-red-600 bg-transparent"
                          : "border-transparent bg-white hover:bg-gray-50"
                      }`}
                    >
                      <label
                        className="mt-2 flex shrink-0 cursor-pointer items-center px-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelected(email.id)}
                          aria-label="E-Mail auswählen"
                        />
                      </label>
                      <button
                        onClick={() => loadEmail(email.id)}
                        className="flex flex-1 items-start gap-3 text-left"
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
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-sm ${
                              unread ? "font-semibold text-gray-900" : "text-gray-800"
                            }`}
                          >
                            {sender}
                          </span>
                          <span className="shrink-0 text-right text-[11px] text-gray-500">
                            <span className="block">
                              Eingang: {formatDateTimeShort(email.createdAt ?? email.date)}
                            </span>
                          </span>
                        </span>
                        <span
                          className={`block truncate text-sm ${
                            unread ? "font-semibold text-gray-900" : "text-gray-700"
                          }`}
                        >
                          {email.subject || "(Ohne Betreff)"}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
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
                          {email.aiCategory ? (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                              {email.aiCategory}
                            </span>
                          ) : null}
                          {email.aiPriority && email.aiPriority !== "normal" ? (
                            <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-700">
                              {email.aiPriority}
                            </span>
                          ) : null}
                          {email.actionRequired ? (
                            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
                              Aktion
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {unread ? <span className="ml-1 mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-600" /> : null}
                      </button>
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
              <p className="px-4 py-3 text-center text-xs text-gray-500">Lade weitere Mails…</p>
            ) : null}
            {!isLoadingEmails && emails.length > 0 && !emailsHasMore ? (
              <p className="px-4 py-3 text-center text-xs text-gray-400">Alle geladenen Mails angezeigt.</p>
            ) : null}
          </div>
        </section>

        <ResizeHandle onDrag={dragList} ariaLabel="Listenbreite ändern" />

        <section
          className={`flex min-h-0 flex-1 flex-col bg-white lg:min-w-0 ${
            mobileView === "list" ? "hidden lg:flex" : "flex"
          }`}
        >
          {selectedEmail ? (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 lg:hidden">
                <button
                  onClick={() => setMobileView("list")}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                >
                  ← Liste
                </button>
              </div>

              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 md:px-4">
                <span
                  className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white sm:flex ${getAvatarColor(
                    selectedEmail.fromEmail || selectedEmail.fromName || selectedEmail.id,
                  )}`}
                  aria-hidden
                >
                  {getInitials(selectedEmail.fromName, selectedEmail.fromEmail)}
                </span>
                <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 md:text-lg">
                  {selectedEmail.subject || "(Ohne Betreff)"}
                </h2>
                <div className="relative shrink-0" data-email-detail-menu-root>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmailDetailMenuOpen((v) => !v);
                    }}
                    aria-label="Mail-Details und Befehle"
                    aria-expanded={emailDetailMenuOpen}
                    aria-haspopup="menu"
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
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
                      className="absolute right-0 z-30 mt-1 max-h-[min(85vh,560px)] w-[min(calc(100vw-2rem),18rem)] overflow-y-auto rounded-md border border-gray-200 bg-white py-2 text-sm shadow-lg"
                    >
                      <div className="border-b border-gray-100 px-3 pb-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Details
                        </p>
                        <p className="mt-1 break-words text-sm font-medium text-gray-900">
                          {selectedEmail.subject || "(Ohne Betreff)"}
                        </p>
                        <p className="mt-2 text-xs text-gray-700">
                          {senderDisplayName(selectedEmail)}
                          {selectedEmail.fromEmail ? (
                            <span className="block break-all text-gray-600">
                              &lt;{selectedEmail.fromEmail}&gt;
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 break-words text-xs text-gray-600">
                          An: {(selectedEmail.toEmails ?? []).join(", ") || "—"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Eingang: {formatDetailDate(selectedEmail.createdAt)}
                        </p>
                        <p className="text-xs text-gray-500">
                          Gesendet: {formatDetailDate(selectedEmail.date)}
                        </p>
                      </div>

                      {bodyContent && bodyContent.html && bodyContent.text ? (
                        <div className="border-b border-gray-100 px-3 py-2">
                          <p className="text-xs font-semibold text-gray-500">Ansicht</p>
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              onClick={() => setBodyMode("text")}
                              className={`flex-1 rounded border px-2 py-1 text-xs ${
                                bodyMode === "text"
                                  ? "border-gray-900 bg-gray-900 text-white"
                                  : "border-gray-300 text-gray-700"
                              }`}
                            >
                              Text
                            </button>
                            <button
                              type="button"
                              onClick={() => setBodyMode("html")}
                              className={`flex-1 rounded border px-2 py-1 text-xs ${
                                bodyMode === "html"
                                  ? "border-gray-900 bg-gray-900 text-white"
                                  : "border-gray-300 text-gray-700"
                              }`}
                            >
                              HTML
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="border-b border-gray-100 px-3 py-2">
                        <p className="text-xs font-semibold text-gray-500">Druck</p>
                        <select
                          value={printMode}
                          onChange={(e) => setPrintMode(e.target.value as "html" | "text")}
                          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
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
                            className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            Inhalt vergrößern
                          </button>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          replyToSelected();
                        }}
                        className="block w-full px-3 py-2 text-left font-medium hover:bg-gray-50"
                      >
                        Antworten
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          forwardSelected();
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        Weiterleiten
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void runAction(`/api/emails/${selectedEmail.id}/mark-read`);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        Gelesen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          void runAction(`/api/emails/${selectedEmail.id}/mark-unread`);
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
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
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
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
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        Spam
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmailDetailMenuOpen(false);
                          printSelectedEmail();
                        }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
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
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
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
                          className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-xs hover:bg-gray-50"
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

              {isLoadingDetail ? (
                <p className="px-4 py-2 text-sm text-gray-600">Lade Detail...</p>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-20 lg:pb-4">
                {selectedEmail.aiSummaryShort ? (
                  <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-sm">
                    <p className="font-semibold text-blue-900">KI-Zusammenfassung</p>
                    <p className="text-blue-900">{selectedEmail.aiSummaryShort}</p>
                    {selectedEmail.aiSummaryLong ? (
                      <p className="mt-1 text-xs text-blue-800">{selectedEmail.aiSummaryLong}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-blue-800">
                      Kategorie: {selectedEmail.aiCategory ?? "unknown"} | Priorität:{" "}
                      {selectedEmail.aiPriority ?? "normal"}
                    </p>
                  </div>
                ) : null}

                {(selectedEmail.attachments?.length ?? 0) > 0 ? (
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-gray-900">Anhänge</h3>
                    <ul className="mt-2 space-y-2">
                      {selectedEmail.attachments.map((attachment) => {
                        const previewUrl = `/api/emails/${selectedEmail.id}/attachments/${attachment.id}/preview`;
                        const downloadUrl = `${previewUrl}?download=1`;
                        return (
                          <li
                            key={attachment.id}
                            onMouseEnter={(e) =>
                              updateAttachmentHoverPreview(e, previewUrl, attachment)
                            }
                            onMouseMove={(e) =>
                              updateAttachmentHoverPreview(e, previewUrl, attachment)
                            }
                            onMouseLeave={() => setHoveredAttachmentPreview(null)}
                            className="relative rounded-lg border border-gray-200 bg-white p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="break-all font-medium text-blue-700 hover:underline"
                                >
                                  📎 {getAttachmentDisplayName(attachment)}
                                </a>
                                <p className="text-xs text-gray-600">
                                  {attachment.mimeType || "unbekannt"} ·{" "}
                                  {attachment.size ?? 0} Bytes
                                </p>
                                <p className="text-xs text-gray-600">
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
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                                >
                                  Öffnen
                                </a>
                                <a
                                  href={downloadUrl}
                                  className="rounded border border-gray-300 px-2 py-1 text-xs"
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
                                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                                >
                                  Drucken
                                </button>
                              </div>
                            </div>

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
                                className="rounded border border-gray-300 px-2 py-1 text-xs"
                              >
                                <option value="mock">MockCloud</option>
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
                                className="min-w-[180px] flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                              />
                              <button
                                onClick={() => saveAttachmentToCloud(attachment.id)}
                                className="rounded border border-gray-300 px-2 py-1 text-xs"
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
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                    Lade Mailinhalt vom IMAP-Server...
                  </div>
                ) : bodyError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {bodyError}
                    <button
                      onClick={() => selectedEmail && loadBody(selectedEmail.id)}
                      className="ml-2 underline"
                    >
                      Erneut versuchen
                    </button>
                  </div>
                ) : bodyContent &&
                  bodyMode === "html" &&
                  bodyContent.html ? (
                  <iframe
                    ref={mailBodyIframeRef}
                    title="Mailinhalt"
                    sandbox=""
                    srcDoc={safeMailDocument}
                    referrerPolicy="no-referrer"
                    className="block w-full max-w-full rounded-lg border border-gray-100 bg-white"
                    style={{ minHeight: "360px", height: "360px", border: "none" }}
                  />
                ) : (
                  <div
                    className="whitespace-pre-wrap overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800"
                    style={{ minHeight: "320px" }}
                  >
                    {bodyContent?.text ||
                      selectedEmail.textPreview ||
                      selectedEmail.snippet ||
                      "(Kein Mailinhalt verfügbar.)"}
                  </div>
                )}

                {selectedEmailCandidates.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <p className="font-semibold text-gray-900">Kontaktvorschläge</p>
                    <ul className="mt-1 space-y-1 text-xs text-gray-700">
                      {selectedEmailCandidates.map((candidate) => (
                        <li key={candidate.id}>
                          {candidate.personName || candidate.email || "Unbekannt"} ({candidate.status})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
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
            className="fixed z-50 w-[320px] rounded-lg border border-gray-200 bg-white p-2 shadow-2xl"
            style={{
              left: Math.max(8, Math.min(mailContextMenu.x, window.innerWidth - 328)),
              top: Math.max(8, Math.min(mailContextMenu.y, window.innerHeight - 420)),
            }}
          >
            <p className="border-b border-gray-100 px-2 pb-1 text-xs text-gray-500">
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
            ) : null}

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
              <p className="px-2 text-xs text-gray-500">Verschieben in Ordner</p>
              <div className="mt-1 flex gap-1 px-1">
                <select
                  value={contextMoveTargetFolder}
                  onChange={(e) => setContextMoveTargetFolder(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
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
                  className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
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
                <p className="px-2 text-xs text-gray-500">Anhänge</p>
                <div className="mt-1 px-1">
                  <select
                    value={selectedContextAttachment?.id ?? ""}
                    onChange={(e) => setContextAttachmentId(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
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
                    className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
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
                    className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
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
                    className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
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
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
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
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
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
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h3 className="text-base font-semibold text-gray-900">
                {composeMode === "new"
                  ? "Neue Mail"
                  : composeMode === "reply"
                    ? "Antwort verfassen"
                    : "Weiterleiten"}
              </h3>
              <button
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700"
                onClick={() => setComposeOpen(false)}
              >
                Abbrechen
              </button>
            </div>

            <div className="space-y-2 border-b border-gray-200 px-4 py-3 text-sm">
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="text-gray-600">Konto</label>
                <select
                  value={composeForm.accountId}
                  onChange={(e) =>
                    setComposeForm((prev) => ({ ...prev, accountId: e.target.value }))
                  }
                  className="rounded border border-gray-300 px-2 py-1.5"
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
                <label className="text-gray-600">An</label>
                <input
                  value={composeForm.to}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, to: e.target.value }))}
                  placeholder="max@firma.de; team@firma.de"
                  className="rounded border border-gray-300 px-2 py-1.5"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="text-gray-600">CC</label>
                <input
                  value={composeForm.cc}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, cc: e.target.value }))}
                  className="rounded border border-gray-300 px-2 py-1.5"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="text-gray-600">BCC</label>
                <input
                  value={composeForm.bcc}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, bcc: e.target.value }))}
                  className="rounded border border-gray-300 px-2 py-1.5"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label className="text-gray-600">Betreff</label>
                <input
                  value={composeForm.subject}
                  onChange={(e) => setComposeForm((prev) => ({ ...prev, subject: e.target.value }))}
                  className="rounded border border-gray-300 px-2 py-1.5"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1 border-b border-gray-200 px-4 py-2 text-xs">
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("bold")}>Fett</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("italic")}>Kursiv</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("underline")}>Unterstr.</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("insertUnorderedList")}>Liste</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("insertOrderedList")}>1.</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("formatBlock", "blockquote")}>Zitat</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("insertHorizontalRule")}>Linie</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("insertText", "✎")}>Zeichen ✎</button>
              <button className="rounded border border-gray-300 px-2 py-1" onClick={() => applyComposeCommand("insertText", "✓")}>Zeichen ✓</button>
              <input
                type="color"
                className="h-7 w-10 rounded border border-gray-300"
                onChange={(e) => applyComposeCommand("foreColor", e.target.value)}
                title="Textfarbe"
              />
              <button
                className="ml-auto rounded border border-gray-300 px-2 py-1"
                onClick={() => {
                  const signature = insertSignatureHtml(composeMode);
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
                onInput={() =>
                  setComposeForm((prev) => ({
                    ...prev,
                    bodyHtml: composeEditorRef.current?.innerHTML || "",
                  }))
                }
                className="min-h-[260px] rounded border border-gray-300 p-3 text-sm focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 px-4 py-3 text-sm">
              <input
                type="datetime-local"
                value={composeForm.sendAtLocal}
                onChange={(e) => setComposeForm((prev) => ({ ...prev, sendAtLocal: e.target.value }))}
                className="rounded border border-gray-300 px-2 py-1.5"
                title="Später senden"
              />
              <button
                disabled={composeSaving}
                onClick={() => void submitCompose("send_later")}
                className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-60"
              >
                Später senden
              </button>
              <button
                disabled={composeSaving}
                onClick={() => void submitCompose("save_draft")}
                className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-60"
              >
                Als Entwurf speichern
              </button>
              <button
                disabled={composeSaving}
                onClick={() => void submitCompose("send_now")}
                className="ml-auto rounded bg-gray-900 px-3 py-1.5 text-white disabled:opacity-60"
              >
                Jetzt senden
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {emptyFolderModalOpen && folderEmptyKind ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !bulkBusy && setEmptyFolderModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
          >
            <h3 className="text-base font-semibold text-gray-900">
              {folderEmptyKind === "trash" ? "Papierkorb leeren?" : "Spam leeren?"}
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              Diese Aktion löscht alle E-Mails im Ordner{" "}
              <span className="font-mono">{selectedFolderPath}</span>{" "}
              <strong>endgültig</strong> und kann nicht rückgängig gemacht werden.
            </p>
            <p className="mt-2 text-xs text-gray-600">
              Tippe zur Bestätigung <span className="font-mono font-semibold">LEEREN</span>{" "}
              ein:
            </p>
            <input
              autoFocus
              value={emptyConfirmText}
              onChange={(e) => setEmptyConfirmText(e.target.value)}
              placeholder="LEEREN"
              className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                disabled={bulkBusy}
                onClick={() => {
                  setEmptyFolderModalOpen(false);
                  setEmptyConfirmText("");
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
              >
                Abbrechen
              </button>
              <button
                disabled={bulkBusy || emptyConfirmText !== "LEEREN"}
                onClick={() => void emptyCurrentFolder()}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {bulkBusy ? "Leere…" : "Endgültig leeren"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {hoveredAttachmentPreview ? (
        <div
          className="pointer-events-none fixed z-[80] hidden h-[240px] w-[360px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl lg:block"
          style={{ left: hoveredAttachmentPreview.x, top: hoveredAttachmentPreview.y }}
        >
          <div className="border-b border-gray-100 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
            Vorschau: {hoveredAttachmentPreview.title}
          </div>
          <iframe
            title={`Vorschau ${hoveredAttachmentPreview.title}`}
            src={hoveredAttachmentPreview.url}
            className="h-[calc(100%-24px)] w-full"
          />
        </div>
      ) : null}

      {isBodyMaximized && selectedEmail && bodyContent ? (
        <div
          className="fixed inset-0 z-50 flex bg-black/60"
          onClick={() => setIsBodyMaximized(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="m-auto flex h-full w-full flex-col bg-white shadow-2xl md:h-[90vh] md:w-[90vw] md:rounded-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Mailinhalt vergrößert"
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 md:px-4">
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 md:text-lg">
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
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
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
                    className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-gray-200 bg-white py-2 text-sm shadow-lg"
                  >
                    {bodyContent.html && bodyContent.text ? (
                      <div className="border-b border-gray-100 px-3 py-2">
                        <p className="text-xs font-semibold text-gray-500">Ansicht</p>
                        <div className="mt-1 flex gap-1">
                          <button
                            type="button"
                            onClick={() => setBodyMode("text")}
                            className={`flex-1 rounded border px-2 py-1 text-xs ${
                              bodyMode === "text"
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "border-gray-300 text-gray-700"
                            }`}
                          >
                            Text
                          </button>
                          <button
                            type="button"
                            onClick={() => setBodyMode("html")}
                            className={`flex-1 rounded border px-2 py-1 text-xs ${
                              bodyMode === "html"
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "border-gray-300 text-gray-700"
                            }`}
                          >
                            HTML
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="px-3 py-2">
                      <p className="text-xs font-semibold text-gray-500">Druck</p>
                      <select
                        value={printMode}
                        onChange={(e) => setPrintMode(e.target.value as "html" | "text")}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs"
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
                        className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-xs hover:bg-gray-50"
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
                className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                ✕
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 md:p-4">
              {bodyMode === "html" && bodyContent.html ? (
                <iframe
                  ref={mailBodyIframeRef}
                  title="Mailinhalt vergrößert"
                  sandbox=""
                  srcDoc={safeMailDocument}
                  referrerPolicy="no-referrer"
                  className="block w-full max-w-full rounded-lg border border-gray-100 bg-white"
                  style={{ minHeight: "360px", height: "360px", border: "none" }}
                />
              ) : (
                <div className="min-h-[50vh] whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800">
                  {bodyContent.text ||
                    selectedEmail.textPreview ||
                    selectedEmail.snippet ||
                    "(Kein Mailinhalt verfügbar.)"}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
