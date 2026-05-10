import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize HTML coming from an IMAP message before rendering it inside a
 * sandboxed iframe.
 *
 * Threats addressed:
 *   - Script execution (`<script>`, inline event handlers like `onerror`,
 *     `onclick`, `onload`)
 *   - `javascript:` and `vbscript:` pseudo-URLs in `href`/`src`
 *   - Active embedded content (`<iframe>`, `<object>`, `<embed>`, `<form>`,
 *     `<base>`, `<meta http-equiv="refresh">`)
 *   - Tracking pixels — external `<img>` references are rewritten to a
 *     blocked-image data URL so they cannot phone home automatically
 *
 * The result is still rendered inside `<iframe sandbox="">` (no allow-scripts,
 * no allow-forms, no allow-same-origin) — that is the second line of defence
 * against anything DOMPurify might miss.
 */

const FORBIDDEN_TAGS = [
  "script",
  "style", // dropped to keep mails predictable; CSS is still inlined via DOMPurify default
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "base",
  "link",
  "meta",
  "applet",
  "audio",
  "video",
  "source",
  "track",
  "canvas",
];

// Transparent 1x1 PNG used to neutralize external <img> sources.
const BLOCKED_PIXEL_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function rewriteExternalImages(): void {
  // Hooks live on the DOMPurify singleton, but we register them only once per
  // process. `(globalThis as any)` avoids the typing dance — DOMPurify's hook
  // API expects `(this: any, node, ...) => void`.
  const flag = "__mailpilotImgHookInstalled";
  const dp = DOMPurify as unknown as Record<string, unknown>;
  if (dp[flag]) return;
  dp[flag] = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;

    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      // Allow inline data:image (e.g. embedded inline images), but neutralize
      // anything that points to a remote host so trackers don't fire.
      const isInlineData = /^data:image\//i.test(src);
      if (!isInlineData) {
        node.setAttribute("src", BLOCKED_PIXEL_DATA_URL);
        node.setAttribute("data-mailpilot-blocked-src", src);
        node.setAttribute("alt", "[externes Bild blockiert]");
      }
      // Defence in depth — disable lazy/eager loading triggers.
      node.removeAttribute("srcset");
      node.removeAttribute("loading");
    }

    if (node.tagName === "A") {
      // Open in a new tab without leaking opener; keeps mailto:/https://
      // working as long as DOMPurify already approved the URL.
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
}

rewriteExternalImages();

export function sanitizeMailHtml(input: string | null | undefined): string {
  if (!input) return "";
  try {
    return DOMPurify.sanitize(input, {
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: [
        "onclick",
        "onerror",
        "onload",
        "onmouseover",
        "onmouseout",
        "onfocus",
        "onblur",
        "onchange",
        "onsubmit",
        "onkeyup",
        "onkeydown",
        "onkeypress",
        "formaction",
        "srcdoc",
      ],
      ALLOW_DATA_ATTR: false,
      // ALLOWED_URI_REGEXP rejects javascript:/vbscript: and most non-standard schemes.
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|data):|#|\/)/i,
    });
  } catch {
    return "";
  }
}

const URL_IN_ANGLE_OR_BARE = /<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<]+)/gi;

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function trimTrailingJunkFromBareUrl(raw: string): string {
  return raw.replace(/[)\].,;:!?]+$/g, "");
}

function safeHttpHrefForLinkify(candidate: string): string | null {
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function htmlContainsAnchorTag(html: string): boolean {
  return /<a(\s|>|\/)/i.test(html);
}

/**
 * Nur Text zwischen Tags — keine bestehenden <a> doppelt wrappen.
 * Split ist fuer typische Mails ausreichend (keine '>' in Attributwerten).
 */
function linkifyBareUrlsBetweenTags(html: string): string {
  return html
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (segment.startsWith("<")) return segment;
      return segment.replace(
        new RegExp(URL_IN_ANGLE_OR_BARE.source, "gi"),
        (full, bracketed: string | undefined, bare: string | undefined) => {
          const normalized = bracketed ? bracketed : trimTrailingJunkFromBareUrl(bare ?? "");
          const href = safeHttpHrefForLinkify(normalized);
          if (!href) return full;
          return `<a href="${escapeHtmlAttr(href)}">${escapeHtmlAttr(normalized)}</a>`;
        },
      );
    })
    .join("");
}

/**
 * Wraps the sanitized email HTML in a minimal document with a tight
 * Content-Security-Policy meta tag so even broken sandbox handling can't
 * fetch remote scripts/frames.
 */
export function buildSafeMailDocument(rawHtml: string | null | undefined): string {
  const firstPass = sanitizeMailHtml(rawHtml);
  const withLinks =
    firstPass && !htmlContainsAnchorTag(firstPass)
      ? linkifyBareUrlsBetweenTags(firstPass)
      : firstPass;
  const safeBody = withLinks !== firstPass ? sanitizeMailHtml(withLinks) : firstPass;
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; script-src 'none';" />
<style>
/* Viele Newsletter setzen overflow:hidden / fixe Hoehen — Inhalt sonst abgeschnitten. */
html,body{height:auto!important;max-height:none!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important}
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:12px;font-size:14px;line-height:1.5;box-sizing:border-box}
*,*::before,*::after{box-sizing:inherit}
img{max-width:100%;height:auto}
a{color:#1d4ed8}
</style>
</head><body>${safeBody}</body></html>`;
}
