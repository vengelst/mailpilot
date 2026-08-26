/**
 * Shared TypeScript types, constants, and pure utility functions used across
 * the mail-workspace module family. This file has zero React dependencies so
 * it can be imported everywhere without side-effects.
 */

import {
  DEFAULT_MAIL_SCROLL_BATCH,
  snapMailScrollBatchSize,
  type MailScrollBatchOption,
} from "@/lib/mailScrollBatch";

export { DEFAULT_MAIL_SCROLL_BATCH, snapMailScrollBatchSize };
export type { MailScrollBatchOption };

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type Account = {
  id: string;
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  isDefault?: boolean;
};

export type Folder = {
  path: string;
  displayName: string;
  delimiter?: string | null;
  specialUse?: string;
  unreadCount?: number;
  totalCount?: number;
  existsCount?: number;
};

export type AutomationRunSummary = {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
};

export type FolderTreeNode = {
  segment: string;
  path: string;
  folder?: Folder;
  children: FolderTreeNode[];
};

export type Attachment = {
  id: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  cloudProvider: "google_drive" | "onedrive" | null;
  cloudPath: string | null;
  saveStatus: "not_saved" | "saved" | "error";
  saveError: string | null;
};

export type Email = {
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

export type LocalFlagFilter = "all" | "none" | "red" | "yellow" | "green";
export type MobileSwipeAction = "none" | "trash" | "mark_read" | "mark_unread" | "print";

export type PendingSwipeTrashUndo = {
  id: string;
  email: Email;
  originalIndex: number;
  sourceAccountId: string;
  sourceFolderPath: string;
  timeoutId: number;
};

export type MailContextMenuState = {
  x: number;
  y: number;
  emailId: string;
  targetIds: string[];
};

export type SignatureData = {
  id: string;
  name: string;
  htmlContent: string;
  accountIds: string[];
  includeOnNewMail: boolean;
  includeOnReply: boolean;
  includeOnForward: boolean;
  isDefault: boolean;
};

export type ComposeMode = "new" | "reply" | "forward";

export type ComposeForm = {
  draftId: string | null;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  sendAtLocal: string;
};

export type ContactCandidate = {
  id: string;
  emailId: string;
  companyName: string | null;
  personName: string | null;
  email: string | null;
  phone: string | null;
  status: "pending" | "exported" | "ignored" | "duplicate";
  confidence: number | null;
};

export type SyncProgress = {
  kind: "incremental" | "full" | "all_folders" | "inbox";
  label: string;
  totalMails?: number;
  processedMails?: number;
  remainingMails?: number;
  etaSeconds?: number | null;
  isEstimate?: boolean;
  lastFolderPath?: string | null;
} | null;

export type LabelDef = {
  id: string;
  name: string;
  color: string | null;
  emailCount: number;
};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const FOLDER_WIDTH_DEFAULT = 280;
export const FOLDER_WIDTH_MIN = 220;
export const FOLDER_WIDTH_MAX = 460;
export const LIST_WIDTH_DEFAULT = 430;
export const LIST_WIDTH_MIN = 320;
export const LIST_WIDTH_MAX = 700;

export const FOLDER_LS_KEY = "mailpilot.layout.folderWidth";
export const LIST_LS_KEY = "mailpilot.layout.listWidth";
export const MOBILE_MAIN_HEADER_LS_KEY = "mailpilot.layout.mobileMainHeaderExpanded";
export const FOLDER_COUNT_MODE_LS_KEY = "mailpilot.layout.folderCountMode";
export const MOBILE_SWIPE_LEFT_ACTION_LS_KEY = "mailpilot.mobileSwipe.leftAction";
export const MOBILE_SWIPE_RIGHT_ACTION_LS_KEY = "mailpilot.mobileSwipe.rightAction";
export const FOLDER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Cosmetic constants
// ---------------------------------------------------------------------------

export const ACCOUNT_COLORS = [
  { bg: "#dbeafe", text: "#1e40af" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#ede9fe", text: "#5b21b6" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#ccfbf1", text: "#115e59" },
];

export const MIME_EXTENSION_MAP: Record<string, string> = {
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

export const AVATAR_PALETTE = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-rose-500",
];

export const MOBILE_SWIPE_ACTION_OPTIONS: Array<{ value: MobileSwipeAction; label: string }> = [
  { value: "none", label: "Keine Aktion" },
  { value: "trash", label: "Papierkorb" },
  { value: "mark_read", label: "Als gelesen" },
  { value: "mark_unread", label: "Als ungelesen" },
  { value: "print", label: "Drucken" },
];

export const LOCAL_FLAG_META: Record<
  Exclude<LocalFlagFilter, "all" | "none">,
  { label: string; className: string }
> = {
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

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getAccountBadgeInfo(
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

export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
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

export function ancestorPaths(path: string, delimiter: string): string[] {
  const segments = path.split(delimiter).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    out.push(segments.slice(0, i + 1).join(delimiter));
  }
  return out;
}

export function getAttachmentDisplayName(attachment: Attachment) {
  const raw = attachment.filename?.trim() ?? "";
  if (raw) return raw;
  const ext = attachment.mimeType ? MIME_EXTENSION_MAP[attachment.mimeType.toLowerCase()] : undefined;
  return ext ? `Anhang.${ext}` : "Anhang";
}

export function getAttachmentPreviewType(attachment: Attachment): "image" | "pdf" | null {
  const mime = (attachment.mimeType || "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  const ext = (attachment.filename || "").split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return null;
}

export function getInitials(name?: string | null, email?: string | null) {
  const source = (name && name.trim()) || (email && email.trim()) || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function getAvatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function senderDisplayName(email: Pick<Email, "fromName" | "fromEmail">) {
  return (email.fromName && email.fromName.trim()) || email.fromEmail || "Unbekannt";
}

export function folderDisplayName(path: string) {
  const clean = path.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return path;
  const segments = clean.split(/[/.]/).filter(Boolean);
  return segments[segments.length - 1] || clean;
}

export function formatDateTimeShort(value: string | null | undefined) {
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

export function formatDetailDate(value: string | Date | null | undefined) {
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

export function toMailtoPlainText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildMailtoQuote(email: Email, intro: string) {
  const preview = toMailtoPlainText(email.textPreview ?? email.snippet).slice(0, 1200);
  const headerLines = [
    intro,
    `Von: ${senderDisplayName(email)}${email.fromEmail ? ` <${email.fromEmail}>` : ""}`,
    `Datum: ${formatDetailDate(email.date)}`,
    `Betreff: ${email.subject ?? ""}`,
  ];
  return preview ? `\n\n${headerLines.join("\n")}\n\n${preview}` : `\n\n${headerLines.join("\n")}`;
}

export function parseRecipientList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function plainToHtml(value: string) {
  const escaped = escapeHtml(value);
  return escaped.replace(/\n/g, "<br/>");
}

export function stripHtml(value: string) {
  if (typeof document === "undefined") return value;
  const container = document.createElement("div");
  container.innerHTML = value;
  return (container.textContent || container.innerText || "").trim();
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatRelative(value: string | null | undefined) {
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

export function formatStatusBadge(status: string | null | undefined) {
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

export function isUnread(email: Email) {
  return !(email.flags ?? []).includes("\\Seen");
}

export function getAttachmentTypeLabel(att: Attachment) {
  const ext = (getAttachmentDisplayName(att).split(".").pop() || att.mimeType || "other").toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "JPEG"
    : ext === "png" ? "PNG"
    : ext === "gif" ? "GIF"
    : ext === "webp" ? "WebP"
    : ext === "pdf" ? "PDF"
    : ext === "doc" || ext === "docx" ? "Word"
    : ext === "xls" || ext === "xlsx" ? "Excel"
    : ext === "ppt" || ext === "pptx" ? "PowerPoint"
    : ext === "zip" || ext === "rar" || ext === "7z" ? "Archiv"
    : ext === "txt" ? "Text"
    : ext === "csv" ? "CSV"
    : ext.toUpperCase();
}

export async function readErrorMessage(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as { error?: string };
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  } catch {
    // ignore
  }
  return fallback;
}
