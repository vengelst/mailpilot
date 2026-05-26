import DOMPurify from "isomorphic-dompurify";

const FORBIDDEN_TAGS = [
  "script",
  "style",
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

const BLOCKED_PIXEL_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let imgHookInstalled = false;
let currentAllowExternal = false;

function installImgHook(): void {
  if (imgHookInstalled) return;
  imgHookInstalled = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;

    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      const isInlineData = /^data:image\//i.test(src);

      if (!isInlineData && !currentAllowExternal) {
        node.setAttribute("data-blocked-src", src);
        node.setAttribute("src", BLOCKED_PIXEL_DATA_URL);
        node.removeAttribute("srcset");
        node.removeAttribute("loading");
      }
    }

    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
}

installImgHook();

export function sanitizeMailHtml(
  input: string | null | undefined,
  options?: { allowExternalImages?: boolean },
): string {
  if (!input) return "";
  currentAllowExternal = options?.allowExternalImages ?? false;
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
      ALLOW_DATA_ATTR: true,
      ALLOWED_URI_REGEXP: options?.allowExternalImages
        ? /^(?:(?:https?|mailto|tel|cid|data):|#|\/)/i
        : /^(?:(?:https?|mailto|tel|cid|data):|#|\/)/i,
    });
  } catch {
    return "";
  } finally {
    currentAllowExternal = false;
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

export interface SafeMailOptions {
  allowExternalImages?: boolean;
}

export function buildSafeMailDocument(
  rawHtml: string | null | undefined,
  options?: SafeMailOptions,
): string {
  const allowImg = options?.allowExternalImages ?? false;
  const firstPass = sanitizeMailHtml(rawHtml, { allowExternalImages: allowImg });
  const withLinks =
    firstPass && !htmlContainsAnchorTag(firstPass)
      ? linkifyBareUrlsBetweenTags(firstPass)
      : firstPass;
  const safeBody = withLinks !== firstPass
    ? sanitizeMailHtml(withLinks, { allowExternalImages: allowImg })
    : firstPass;

  const imgCSP = allowImg ? "img-src data: https: http:;" : "img-src data:;";

  const blockedImgStyle = allowImg
    ? ""
    : `
img[data-blocked-src]{
  display:inline-block;
  min-width:120px;
  min-height:48px;
  background:#f0f4f8;
  border:1px dashed #94a3b8;
  border-radius:6px;
  position:relative;
  vertical-align:middle;
}
img[data-blocked-src]::after{
  content:"\\1F5BC  Bild blockiert";
  position:absolute;inset:0;
  display:flex;align-items:center;justify-content:center;
  font-size:11px;color:#64748b;
  background:#f0f4f8;border-radius:6px;
  padding:4px 8px;text-align:center;
}`;

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgCSP} style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; script-src 'unsafe-inline';" />
<style>
html{height:auto!important;max-height:none!important;overflow-x:hidden!important;overflow-y:auto;-webkit-overflow-scrolling:touch}
body{height:auto!important;max-height:none!important;min-height:min-content;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;margin:0;padding:12px;font-size:14px;line-height:1.6;box-sizing:border-box;word-wrap:break-word;overflow-wrap:break-word}
*,*::before,*::after{box-sizing:inherit}
img{max-width:100%!important;height:auto!important}
table{max-width:100%!important;width:auto!important;table-layout:fixed!important}
td,th{max-width:100%!important;word-wrap:break-word!important;overflow-wrap:break-word!important}
div,section,article,header,footer,aside,main,nav{max-width:100%!important;overflow-x:hidden!important}
a{color:#2563eb}
a:hover{color:#1d4ed8}
pre,code{max-width:100%!important;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word}
${blockedImgStyle}
</style>
</head><body>${safeBody}
<script>
document.addEventListener("click",function(e){
  var a=e.target;
  while(a&&a.tagName!=="A")a=a.parentElement;
  if(!a)return;
  var href=a.getAttribute("href");
  if(!href)return;
  e.preventDefault();
  e.stopPropagation();
  parent.postMessage({type:"mailpilot-link-click",href:href},"*");
},true);
</script>
</body></html>`;
}
