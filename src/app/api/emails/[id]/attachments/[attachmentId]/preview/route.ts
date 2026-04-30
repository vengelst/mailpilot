import { getSessionFromCookies } from "@/server/auth/session";
import { fail } from "@/lib/http";
import { loadAttachmentContent } from "@/server/imap/imapService";

async function resolveParams(
  params: Promise<{ id: string; attachmentId: string }>,
) {
  const resolved = await params;
  return { id: resolved.id, attachmentId: resolved.attachmentId };
}

function sanitizeFilename(input?: string | null) {
  if (!input) return "attachment";
  return input.replace(/[\r\n"\\]/g, "_");
}

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

function buildDownloadFilename(filename: string | null | undefined, mimeType: string | null | undefined) {
  const safe = sanitizeFilename(filename);
  if (safe !== "attachment") return safe;
  const ext = mimeType ? MIME_EXTENSION_MAP[mimeType.toLowerCase()] : undefined;
  return ext ? `attachment.${ext}` : safe;
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadWithRetry(userId: string, id: string, attachmentId: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await loadAttachmentContent(userId, id, attachmentId);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const transient =
        message.includes("connection not available") ||
        message.includes("connection closed") ||
        message.includes("timeout") ||
        message.includes("socket");
      if (!transient || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Preview failed");
}

export async function GET(
  req: Request,
  context: {
    params: Promise<{ id: string; attachmentId: string }>;
  },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const { id, attachmentId } = await resolveParams(context.params);
    const { attachment, content } = await loadWithRetry(session.userId, id, attachmentId);

    const url = new URL(req.url);
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    const filename = buildDownloadFilename(attachment.filename, attachment.mimeType);
    const mimeType = attachment.mimeType || "application/octet-stream";

    return new Response(new Uint8Array(content), {
      headers: {
        "content-type": mimeType,
        "content-length": String(content.byteLength),
        "content-disposition": `${disposition}; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const url = new URL(req.url);
    const inlinePreview = url.searchParams.get("download") !== "1";
    const message = error instanceof Error ? error.message : "Preview failed";
    if (message.toLowerCase().includes("not found")) return fail("Attachment not found", 404);
    if (inlinePreview) {
      const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"/><title>Anhang-Vorschau</title>
      <style>
      body{font-family:Arial,Helvetica,sans-serif;padding:12px;color:#1f2937;background:#fff}
      .box{border:1px solid #e5e7eb;border-radius:8px;padding:10px;background:#f9fafb}
      .hint{font-size:12px;color:#6b7280;margin-top:6px}
      </style></head><body>
      <div class="box">
        <strong>Vorschau aktuell nicht verfügbar</strong>
        <div class="hint">${escapeHtml(message)}</div>
        <div class="hint">Bitte Anhang mit „Öffnen“ oder „Herunterladen“ versuchen.</div>
      </div>
      </body></html>`;
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
      });
    }
    return fail(message, 400);
  }
}
