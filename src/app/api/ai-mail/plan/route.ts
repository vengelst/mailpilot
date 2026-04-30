import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";
import { generateMailPlan } from "@/server/ai/planProvider";
import {
  detectAssistantIntent,
  extractPromptFilter,
  intentRunsActionPlan,
} from "@/server/ai/promptFilter";
import { resolveAiConfig, resolveAiRuntimeConfig } from "@/server/ai/aiConfig";
import { syncFolders } from "@/server/imap/imapService";

// Hard ceiling for the request payload — kept generous so count/search
// queries are not blocked by this validation. The per-intent limits below
// (`MAX_AI_CANDIDATES`, `SAMPLE_EMAILS_LIMIT`) are enforced at runtime so we
// can deliver a friendly message instead of a raw Zod error.
const schema = z.object({
  prompt: z.string().min(3).max(2000),
  accountId: z.string().min(1),
  folderPath: z.string().optional(),
  scope: z.enum(["current_folder", "all_folders", "unread", "unanalyzed"]).optional(),
  daysBack: z.number().int().min(1).max(365).optional(),
  maxCandidates: z.number().int().min(1).max(5000).optional(),
});

/** Hard ceiling for *action* plans — caps how many emails the LLM ever sees. */
const MAX_AI_CANDIDATES = 200;
/** How many sample headers we expose to the UI for count/search. */
const SAMPLE_EMAILS_LIMIT = 50;

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const payload = schema.parse(await req.json());

    const account = await prisma.mailAccount.findFirst({
      where: { id: payload.accountId, userId: session.userId },
      select: { id: true },
    });
    if (!account) return fail("Account not found", 404);

    const scope = payload.scope ?? "current_folder";

    // Deterministic prompt pre-filter — extract obvious search terms and a
    // time window from the prompt so we don't ship 50 random candidates to
    // the AI when the user clearly asked for "Vodafone last 30 days".
    const promptFilter = extractPromptFilter(payload.prompt);
    const effectiveDaysBack = payload.daysBack ?? promptFilter.daysBack ?? null;
    const intent = detectAssistantIntent(payload.prompt);
    // Default `unknown` to "search" — safer than firing an action plan on a
    // prompt the heuristics don't recognise. The user can be more explicit if
    // they actually wanted actions.
    const effectiveIntent = intent === "unknown" ? "search" : intent;
    const isInformational = !intentRunsActionPlan(effectiveIntent);

    // For action plans we cap how many emails the LLM ever sees. Reject
    // explicit oversized requests with a friendly message instead of letting
    // them silently shrink — the user typed 2000 for a reason and deserves
    // an explanation. For count/search this limit doesn't apply.
    if (
      !isInformational &&
      payload.maxCandidates !== undefined &&
      payload.maxCandidates > MAX_AI_CANDIDATES
    ) {
      return fail(
        `Maximal ${MAX_AI_CANDIDATES} E-Mails pro KI-Aktionsauftrag erlaubt. ` +
          `Filter/Zeitraum bitte einschränken oder Auswahl reduzieren.`,
        400,
      );
    }
    // The actual fetch limit:
    //   - count/search: only enough rows to fill the sample list
    //   - action:       up to MAX_AI_CANDIDATES (or whatever the user asked for)
    const fetchLimit = isInformational
      ? SAMPLE_EMAILS_LIMIT
      : Math.min(payload.maxCandidates ?? 50, MAX_AI_CANDIDATES);

    const where: Prisma.EmailIndexWhereInput = {
      accountId: payload.accountId,
      account: { userId: session.userId },
    };
    if (scope === "current_folder") {
      if (!payload.folderPath) {
        return fail("folderPath required for current_folder scope", 400);
      }
      where.folderPath = payload.folderPath;
    }
    if (scope === "unread") {
      where.NOT = { flags: { has: "\\Seen" } };
    }
    if (scope === "unanalyzed") {
      where.aiAnalyzed = false;
    }
    if (effectiveDaysBack) {
      const cutoff = new Date(Date.now() - effectiveDaysBack * 24 * 60 * 60 * 1000);
      where.date = { gte: cutoff };
    }
    if (promptFilter.terms.length > 0) {
      // Match ANY extracted term against any of these text fields.
      // `mode: "insensitive"` so "vodafone" hits "Vodafone GmbH".
      where.OR = promptFilter.terms.flatMap((term) => [
        { subject: { contains: term, mode: "insensitive" as const } },
        { fromEmail: { contains: term, mode: "insensitive" as const } },
        { fromName: { contains: term, mode: "insensitive" as const } },
        { snippet: { contains: term, mode: "insensitive" as const } },
        { textPreview: { contains: term, mode: "insensitive" as const } },
        { bodyPlain: { contains: term, mode: "insensitive" as const } },
        { bodyText: { contains: term, mode: "insensitive" as const } },
      ]);
    }

    const rows = await prisma.emailIndex.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: fetchLimit,
      select: {
        id: true,
        subject: true,
        fromEmail: true,
        fromName: true,
        date: true,
        folderPath: true,
        snippet: true,
        aiCategory: true,
        hasAttachments: true,
      },
    });

    const folders = await syncFolders(payload.accountId, session.userId);
    const availableFolders = folders.map((f) => f.path);

    const candidates = rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      fromEmail: row.fromEmail,
      fromName: row.fromName,
      date: row.date ? row.date.toISOString() : null,
      folderPath: row.folderPath,
      snippet: row.snippet,
      aiCategory: row.aiCategory,
      hasAttachments: row.hasAttachments,
    }));

    const providerInfo = await resolveAiConfig(session.userId);

    const noteParts: string[] = [];
    if (promptFilter.terms.length > 0) {
      noteParts.push(`Suchbegriffe: ${promptFilter.terms.join(", ")}`);
    }
    if (effectiveDaysBack) {
      noteParts.push(`Zeitraum: ${effectiveDaysBack} Tage`);
    }
    const noteSuffix = noteParts.length > 0 ? ` (${noteParts.join(" · ")})` : "";

    // ---------- Informational intents — count / search ----------
    if (isInformational) {
      // Get the precise total (independent of `maxCandidates`).
      const total = await prisma.emailIndex.count({ where });

      // Group breakdown — per folder always, per sender for "count" intent.
      const byFolderRaw = await prisma.emailIndex.groupBy({
        by: ["folderPath"],
        where,
        _count: { _all: true },
        orderBy: { _count: { folderPath: "desc" } },
        take: 50,
      });
      const byFolder = byFolderRaw.map((entry) => ({
        folderPath: entry.folderPath,
        count: entry._count._all,
      }));

      let bySender:
        | Array<{ fromEmail: string | null; fromName: string | null; count: number }>
        | undefined;
      if (effectiveIntent === "count") {
        const senderRaw = await prisma.emailIndex.groupBy({
          by: ["fromEmail"],
          where,
          _count: { _all: true },
          orderBy: { _count: { fromEmail: "desc" } },
          take: 10,
        });
        // Resolve fromName separately for top senders (group-by can't easily
        // mix two non-key columns).
        const topSenderEmails = senderRaw
          .map((s) => s.fromEmail)
          .filter((v): v is string => !!v);
        const namesRow = topSenderEmails.length
          ? await prisma.emailIndex.findMany({
              where: { ...where, fromEmail: { in: topSenderEmails } },
              select: { fromEmail: true, fromName: true },
              distinct: ["fromEmail"],
            })
          : [];
        const nameByEmail = new Map(
          namesRow.map((r) => [r.fromEmail, r.fromName ?? null]),
        );
        bySender = senderRaw.map((entry) => ({
          fromEmail: entry.fromEmail,
          fromName: entry.fromEmail ? nameByEmail.get(entry.fromEmail) ?? null : null,
          count: entry._count._all,
        }));
      }

      // Show up to SAMPLE_EMAILS_LIMIT headers (already what we fetched).
      const sampleEmails = candidates.slice(0, SAMPLE_EMAILS_LIMIT).map((c) => ({
        id: c.id,
        subject: c.subject,
        fromName: c.fromName,
        fromEmail: c.fromEmail,
        date: c.date,
        folderPath: c.folderPath,
      }));

      const sampleNote =
        total > sampleEmails.length
          ? ` Es werden die ersten ${sampleEmails.length} Treffer als Beispiel angezeigt.`
          : "";
      const summary =
        total === 0
          ? `Keine passenden E-Mails gefunden${noteSuffix}.`
          : effectiveIntent === "count"
            ? `${total} passende E-Mail${total === 1 ? "" : "s"} gefunden${noteSuffix}.${sampleNote}`
            : `${total} Treffer${noteSuffix}.${sampleNote}`;

      await writeAuditLog({
        userId: session.userId,
        accountId: payload.accountId,
        action: "ai.assistant.query",
        actor: "user",
        afterJson: {
          intent: effectiveIntent,
          provider: "deterministic",
          terms: promptFilter.terms,
          daysBack: effectiveDaysBack,
          resultCount: total,
        },
      });

      return ok({
        kind: effectiveIntent === "count" ? "count" : "search",
        intent: effectiveIntent,
        provider: providerInfo.provider,
        isRealProvider: providerInfo.isRealProvider,
        hasApiKey: providerInfo.hasApiKey,
        promptFilter,
        candidateCount: total,
        total,
        byFolder,
        bySender,
        sampleEmails,
        plan: { summary, actions: [] },
      });
    }

    // ---------- Action intents — actually call the LLM ----------
    if (candidates.length === 0) {
      return ok({
        kind: "plan",
        intent: effectiveIntent,
        provider: providerInfo.provider,
        isRealProvider: providerInfo.isRealProvider,
        hasApiKey: providerInfo.hasApiKey,
        plan: {
          summary: `Keine passenden E-Mails gefunden${noteSuffix}.`,
          actions: [],
        },
        candidateCount: 0,
        promptFilter,
      });
    }

    await writeAuditLog({
      userId: session.userId,
      accountId: payload.accountId,
      action: "ai.plan.requested",
      actor: "user",
      afterJson: {
        prompt: payload.prompt.slice(0, 200),
        intent: effectiveIntent,
        provider: providerInfo.provider,
        scope,
        candidateCount: candidates.length,
        promptFilter,
      },
    });

    const runtime = await resolveAiRuntimeConfig(session.userId);
    const plan = await generateMailPlan({
      prompt: payload.prompt,
      candidates,
      availableFolders,
      runtimeConfig: runtime,
    });

    await writeAuditLog({
      userId: session.userId,
      accountId: payload.accountId,
      action: "ai.plan.generated",
      actor: "ai",
      afterJson: {
        provider: providerInfo.provider,
        actionCount: plan.actions.length,
        summary: plan.summary.slice(0, 200),
      },
    });

    return ok({
      kind: "plan",
      intent: effectiveIntent,
      provider: providerInfo.provider,
      isRealProvider: providerInfo.isRealProvider,
      hasApiKey: providerInfo.hasApiKey,
      plan,
      candidateCount: candidates.length,
      promptFilter,
    });
  } catch (error) {
    // Zod errors have a multi-line JSON-ish message — translate to plain text.
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      const path = first?.path?.join(".") || "Eingabe";
      return fail(`Ungültige Eingabe (${path}): ${first?.message ?? "siehe Doku"}`, 400);
    }
    return fail(error instanceof Error ? error.message : "Plan generation failed", 400);
  }
}
