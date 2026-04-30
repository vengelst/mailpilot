type PathTemplateContext = {
  year: string;
  month: string;
  senderDomain: string;
  detectedCompany: string;
  keyword: string;
};

const DEFAULT_TEMPLATES = [
  "/Rechnungen/{{year}}/{{month}}/{{senderDomain}}/",
  "/Kunden/{{detectedCompany}}/{{year}}/",
  "/Projekte/{{keyword}}/",
];

function safeSegment(value?: string | null, fallback = "unknown") {
  const cleaned = (value ?? "").trim().replace(/[\\/:*?"<>|]/g, "_");
  return cleaned.length > 0 ? cleaned : fallback;
}

export function defaultPathTemplates() {
  return [...DEFAULT_TEMPLATES];
}

export function buildPathTemplateContext(input: {
  date?: Date | null;
  senderDomain?: string | null;
  detectedCompany?: string | null;
  keyword?: string | null;
}): PathTemplateContext {
  const date = input.date ? new Date(input.date) : new Date();
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    senderDomain: safeSegment(input.senderDomain, "unknown-domain"),
    detectedCompany: safeSegment(input.detectedCompany, "unknown-company"),
    keyword: safeSegment(input.keyword, "allgemein"),
  };
}

export function renderTargetPath(template: string, ctx: PathTemplateContext) {
  const rendered = template
    .replaceAll("{{year}}", ctx.year)
    .replaceAll("{{month}}", ctx.month)
    .replaceAll("{{senderDomain}}", ctx.senderDomain)
    .replaceAll("{{detectedCompany}}", ctx.detectedCompany)
    .replaceAll("{{keyword}}", ctx.keyword);

  if (!rendered.startsWith("/")) return `/${rendered}`;
  return rendered;
}
