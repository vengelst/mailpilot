import { getSessionFromCookies } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { fail } from "@/lib/http";
import { loadMessageBody } from "@/server/imap/imapService";

async function resolveId(params: Promise<{ id: string }> | { id: string }) {
  return (await Promise.resolve(params)).id;
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") === "text" ? "text" : "html";

  const id = await resolveId(context.params);
  const email = await prisma.emailIndex.findFirst({
    where: { id, account: { userId: session.userId } },
    include: {
      attachments: true,
      contacts: true,
    },
  });
  if (!email) return fail("Email not found", 404);

  let bodyText = email.textPreview ?? email.snippet ?? "";
  let bodyHtml = "";
  try {
    const fresh = await loadMessageBody(id, session.userId);
    if (fresh.text || fresh.textFromHtml) {
      bodyText = fresh.text || fresh.textFromHtml;
    }
    if (fresh.html) {
      bodyHtml = fresh.html;
    }
  } catch {
    // fall back to indexed preview if IMAP not reachable
  }

  const contacts = email.contacts.filter(
    (c) => c.companyName || c.personName || c.email || c.phone || c.address,
  );

  const contactsBlock = contacts.length
    ? `<section class="contacts">
         <h3>Erkannte Kontaktdaten</h3>
         <ul>
           ${contacts
             .map((c) => {
               const parts = [
                 c.personName ? `<strong>${escapeHtml(c.personName)}</strong>` : "",
                 c.companyName ? escapeHtml(c.companyName) : "",
                 c.email ? `E-Mail: ${escapeHtml(c.email)}` : "",
                 c.phone ? `Tel.: ${escapeHtml(c.phone)}` : "",
                 c.address ? `Adresse: ${escapeHtml(c.address)}` : "",
               ].filter(Boolean);
               return `<li>${parts.join(" · ")}</li>`;
             })
             .join("")}
         </ul>
       </section>`
    : "";

  const attachmentsBlock = email.attachments.length
    ? `<section class="attachments">
         <h3>Anhänge</h3>
         <ul>
           ${email.attachments
             .map(
               (a) =>
                 `<li>${escapeHtml(a.filename ?? "Datei")} (${escapeHtml(
                   a.mimeType ?? "unbekannt",
                 )}, ${a.size ?? 0} Bytes)</li>`,
             )
             .join("")}
         </ul>
       </section>`
    : "";

  const aiBlock = email.aiSummaryShort
    ? `<section class="ai">
         <h3>KI-Zusammenfassung</h3>
         <p>${escapeHtml(email.aiSummaryShort)}</p>
         ${email.aiSummaryLong ? `<p class="ai-long">${escapeHtml(email.aiSummaryLong)}</p>` : ""}
       </section>`
    : "";

  const html = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(email.subject ?? "E-Mail")}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      h3 { font-size: 14px; margin: 18px 0 6px; }
      .meta { margin-bottom: 4px; font-size: 13px; }
      .label { font-weight: 700; }
      .content { white-space: pre-wrap; line-height: 1.5; margin-top: 16px; font-size: 13px; }
      ul { padding-left: 18px; margin: 4px 0; font-size: 13px; }
      .ai-long { color: #444; font-size: 12px; }
      @media print {
        body { margin: 12mm; }
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(email.subject ?? "(Ohne Betreff)")}</h1>
    <div class="meta"><span class="label">Von:</span> ${escapeHtml(email.fromName ?? "")} ${
      email.fromEmail ? `&lt;${escapeHtml(email.fromEmail)}&gt;` : ""
    }</div>
    <div class="meta"><span class="label">An:</span> ${escapeHtml(
      (email.toEmails ?? []).join(", "),
    )}</div>
    ${
      (email.ccEmails ?? []).length
        ? `<div class="meta"><span class="label">CC:</span> ${escapeHtml(
            (email.ccEmails ?? []).join(", "),
          )}</div>`
        : ""
    }
    <div class="meta"><span class="label">Datum:</span> ${
      email.date ? new Date(email.date).toLocaleString("de-DE") : ""
    }</div>
    <div class="content">${
      mode === "html"
        ? bodyHtml || `<pre>${escapeHtml(bodyText)}</pre>`
        : `<pre>${escapeHtml(bodyText)}</pre>`
    }</div>
    ${attachmentsBlock}
    ${contactsBlock}
    ${aiBlock}
    <script>window.onload = () => window.print();</script>
  </body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
