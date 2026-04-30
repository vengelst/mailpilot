import { prisma } from "@/server/db/prisma";
import { analyzeEmailForUser } from "@/server/ai";
import { loadMessageBody } from "@/server/imap/imapService";
import { writeAuditLog } from "@/server/audit/auditLog";

/**
 * Run AI classification on a single mail.
 *
 * If the body is not yet cached, we fetch it from IMAP first (`loadMessageBody`
 * with cache). The AI then sees the *real* mail content (plain text from
 * text/plain or HTML→plain fallback), not just the 240-char `textPreview`
 * generated during sync.
 *
 * Audit:
 *   - ai.analysis.started
 *   - ai.body.loaded_for_analysis  (only if body had to be fetched here)
 *   - ai.analysis.finished | ai.analysis.failed
 */
export async function runAiClassificationForEmail(emailId: string, userId: string) {
  const email = await prisma.emailIndex.findFirst({
    where: { id: emailId, account: { userId } },
    select: {
      id: true,
      accountId: true,
      subject: true,
      fromEmail: true,
      textPreview: true,
      bodyText: true,
      bodyPlain: true,
      bodyFetchedAt: true,
    },
  });
  if (!email) {
    throw new Error("Email not found");
  }

  await writeAuditLog({
    userId,
    accountId: email.accountId,
    emailId: email.id,
    action: "ai.analysis.started",
    actor: "ai",
  });

  let bodyForAi = email.bodyPlain || email.bodyText || "";
  let bodyWasFetched = false;
  if (!email.bodyFetchedAt) {
    try {
      const body = await loadMessageBody(emailId, userId);
      bodyForAi = body.textFromHtml || body.text || email.textPreview || "";
      bodyWasFetched = !body.cached;
    } catch {
      // IMAP unreachable → fall back to indexed preview. AI still runs but with less context.
      bodyForAi = email.textPreview || "";
    }
  }

  if (bodyWasFetched) {
    await writeAuditLog({
      userId,
      accountId: email.accountId,
      emailId: email.id,
      action: "ai.body.loaded_for_analysis",
      actor: "ai",
    });
  }

  let ai;
  try {
    ai = await analyzeEmailForUser(userId, {
      subject: email.subject,
      from: email.fromEmail,
      body: bodyForAi,
    });
  } catch (error) {
    await writeAuditLog({
      userId,
      accountId: email.accountId,
      emailId: email.id,
      action: "ai.analysis.failed",
      actor: "ai",
      afterJson: {
        error: (error instanceof Error ? error.message : "AI failed").slice(0, 500),
      },
    });
    throw error;
  }

  await prisma.emailIndex.update({
    where: { id: email.id },
    data: {
      aiAnalyzed: true,
      aiCategory: ai.category,
      aiPriority: ai.priority,
      aiSummaryShort: ai.summaryShort,
      aiSummaryLong: ai.summaryLong,
      aiKeywords: ai.keywords,
      aiRecommendedFolder: ai.recommendedFolder ?? null,
      aiRecommendedAction: ai.recommendedAction,
      aiConfidence: ai.confidence,
      actionRequired: ai.actionRequired,
    },
  });

  if (ai.detectedContacts.length > 0) {
    await prisma.contactCandidate.deleteMany({
      where: {
        emailId: email.id,
        status: "pending",
      },
    });

    await prisma.contactCandidate.createMany({
      data: ai.detectedContacts.map((contact) => ({
        emailId: email.id,
        companyName: contact.companyName,
        personName: contact.personName,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
        confidence: contact.confidence,
        status: "pending",
      })),
    });
  }

  await writeAuditLog({
    userId,
    accountId: email.accountId,
    emailId: email.id,
    action: "ai.analysis.finished",
    actor: "ai",
    afterJson: {
      category: ai.category,
      priority: ai.priority,
      actionRequired: ai.actionRequired,
      confidence: ai.confidence,
    },
  });

  return ai;
}

export async function runAiClassificationJob(input: {
  userId: string;
  accountId?: string;
  emailIds?: string[];
}) {
  const candidates = await prisma.emailIndex.findMany({
    where: {
      account: { userId: input.userId },
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.emailIds?.length ? { id: { in: input.emailIds } } : {}),
      aiAnalyzed: false,
    },
    select: { id: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  let analyzedCount = 0;
  const analyzedEmailIds: string[] = [];
  for (const item of candidates) {
    await runAiClassificationForEmail(item.id, input.userId);
    analyzedCount += 1;
    analyzedEmailIds.push(item.id);
  }

  return { analyzedCount, analyzedEmailIds };
}
