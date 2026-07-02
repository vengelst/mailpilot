export function matchesSenderProfile(senderEmail: string, patterns: string[]): boolean {
  const emailLower = senderEmail.toLowerCase();
  const domain = emailLower.split("@")[1];

  for (const pattern of patterns) {
    const p = pattern.toLowerCase();
    if (p.includes("@") && !p.includes("*")) {
      if (emailLower === p) return true;
    } else if (p.includes("*")) {
      const regex = new RegExp(
        "^" + p.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );
      if (regex.test(emailLower)) return true;
    } else {
      if (domain === p) return true;
    }
  }
  return false;
}

export function extractDomainFromEmail(email: string): string {
  return email.toLowerCase().split("@")[1] ?? "";
}

export function suggestProfileName(fromName: string, email: string): string {
  if (fromName && fromName.trim()) {
    const parts = fromName.trim().split(/\s+/);
    if (parts.length >= 2) return fromName.trim();
    return fromName.trim();
  }
  const domain = extractDomainFromEmail(email);
  const domainBase = domain.split(".")[0] ?? domain;
  return domainBase.charAt(0).toUpperCase() + domainBase.slice(1);
}

export function suggestPatterns(email: string): string[] {
  const domain = extractDomainFromEmail(email);
  return domain ? [domain] : [email.toLowerCase()];
}

const CATEGORY_FOLDER_MAP: Record<string, string> = {
  kunde: "Kunde",
  kunden: "Kunde",
  lieferant: "Lieferant",
  lieferanten: "Lieferant",
  subunternehmer: "Subunternehmer",
  sub: "Subunternehmer",
  privat: "Privat",
  private: "Privat",
  werbung: "Werbung",
  newsletter: "Werbung",
  spam: "Werbung",
};

export function inferCategoryFromFolder(folderPath: string): string {
  const lower = folderPath.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_FOLDER_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return "Sonstiges";
}
