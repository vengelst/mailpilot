import type { ReactNode } from "react";

/**
 * text/plain-Mails: URLs oft als <https://…> (RFC-ähnlich). Macht http(s)-URLs klickbar.
 */
const URL_IN_ANGLE_OR_BARE = /<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<]+)/gi;

function trimTrailingJunkFromBareUrl(raw: string): string {
  return raw.replace(/[)\].,;:!?]+$/g, "");
}

function safeHttpHref(candidate: string): string | null {
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

export function linkifyMailPlainText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const re = new RegExp(URL_IN_ANGLE_OR_BARE.source, URL_IN_ANGLE_OR_BARE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    const bracketed = m[1];
    const bare = m[2];
    const rawToken = bracketed || bare;
    const normalized = bracketed ? bracketed : trimTrailingJunkFromBareUrl(bare);
    const href = safeHttpHref(normalized);
    if (href) {
      out.push(
        <a
          key={`u-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="break-all text-blue-700 underline underline-offset-2 hover:text-blue-900"
        >
          {normalized}
        </a>,
      );
    } else {
      out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}
