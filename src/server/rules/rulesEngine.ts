/**
 * Rules Engine — evaluates user-defined mail rules and blocked-sender policies
 * against incoming emails, then executes the configured actions (move, label,
 * categorize, etc.).
 *
 * Processing order:
 *   1. Blocked-sender policies (exact email / domain match)
 *   2. User-defined rules, evaluated in ascending priority order
 *
 * Each rule consists of a condition tree (AND/OR logic) and one or more actions.
 * Evaluation stops early when a matched rule has `stopAfterMatch` set.
 */

import { prisma } from "@/server/db/prisma";
import { BlockedSenderAction } from "@prisma/client";
import { writeAuditLog } from "@/server/audit/auditLog";
import { moveIndexedEmail, moveIndexedEmailToSpecial } from "@/server/imap/imapService";
import { applyEmailIndexFolderMove } from "@/server/imap/service/applyEmailIndexMove";
import { runAiClassificationForEmail } from "@/server/automation/aiClassificationJob";
import {
  RuleAction,
  RuleCondition,
  RuleConditionNode,
  ruleActionContainerSchema,
  ruleConditionSchema,
} from "@/server/rules/schemas";

/** Context passed into the rules engine for a single email evaluation run. */
type RuleContext = {
  userId: string;
  emailId: string;
  /** When true, skip blocked-sender checks (e.g. if already handled upstream). */
  skipBlockedSender?: boolean;
};

/** Extracts the domain part from an email address, lowercased. Returns "" for invalid input. */
function toDomain(email?: string | null) {
  if (!email || !email.includes("@")) return "";
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Checks whether a sender's domain matches a blocked domain entry.
 * Supports exact match and subdomain match (e.g. "sub.example.com" matches "example.com").
 */
function domainMatches(blockedDomain?: string | null, senderDomain?: string) {
  if (!blockedDomain || !senderDomain) return false;
  const blocked = blockedDomain.toLowerCase();
  const sender = senderDomain.toLowerCase();
  // Exact match OR subdomain match (sender ends with ".blocked")
  return sender === blocked || sender.endsWith(`.${blocked}`);
}

/** Case-insensitive string comparison supporting equals, contains, and endsWith operators. */
function stringOp(left: string, operator: "equals" | "contains" | "endsWith", right: string) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (operator === "equals") return a === b;
  if (operator === "endsWith") return a.endsWith(b);
  return a.includes(b);
}

/** Subset of email fields needed by the rule condition evaluator. */
export type RuleEmail = {
  fromEmail?: string | null;
  subject?: string | null;
  hasAttachments: boolean;
  aiCategory?: string | null;
  aiPriority?: string | null;
  aiKeywords: string[];
  attachmentFilenames?: string[];
};

/**
 * Evaluates a single leaf condition (one field comparison) against an email.
 * Returns true if the email field satisfies the condition's operator and value.
 */
function evaluateLeaf(
  condition: Exclude<RuleConditionNode, { all?: RuleConditionNode[]; any?: RuleConditionNode[] }>,
  email: RuleEmail,
): boolean {
  switch (condition.field) {
    case "fromEmail":
      return stringOp(email.fromEmail ?? "", condition.operator, condition.value);
    case "fromDomain":
      return stringOp(toDomain(email.fromEmail), "equals", condition.value);
    case "subject":
      return stringOp(email.subject ?? "", "contains", condition.value);
    case "hasAttachments":
      return email.hasAttachments === condition.value;
    case "attachmentFilename":
      return (email.attachmentFilenames ?? []).some((filename) =>
        stringOp(filename, condition.operator, condition.value),
      );
    case "aiCategory":
      return stringOp(email.aiCategory ?? "", condition.operator, condition.value);
    case "aiPriority":
      return stringOp(email.aiPriority ?? "", condition.operator, condition.value);
    case "keywords":
      return email.aiKeywords.some((keyword) => stringOp(keyword, condition.operator, condition.value));
    default:
      return false;
  }
}

/**
 * Recursively evaluates a condition tree node. Leaf nodes delegate to
 * {@link evaluateLeaf}; group nodes combine children via AND (`all`) / OR (`any`).
 */
function evaluateNode(
  node: RuleConditionNode,
  email: RuleEmail,
): boolean {
  if ("field" in node) {
    return evaluateLeaf(node, email);
  }

  // Both `all` (AND) and `any` (OR) must pass; absent groups default to true
  const allMatched = node.all ? node.all.every((child) => evaluateNode(child, email)) : true;
  const anyMatched = node.any ? node.any.some((child) => evaluateNode(child, email)) : true;
  return allMatched && anyMatched;
}

/**
 * Evaluates a complete rule condition (top-level AND/OR group) against an email.
 *
 * @param condition - The parsed condition tree of a mail rule.
 * @param email     - The email fields to test against.
 * @returns `true` if the email matches all required conditions.
 */
export function evaluateRuleCondition(
  condition: RuleCondition,
  email: RuleEmail,
): boolean {
  const allMatched = condition.all ? condition.all.every((node) => evaluateNode(node, email)) : true;
  const anyMatched = condition.any ? condition.any.some((node) => evaluateNode(node, email)) : true;
  return allMatched && anyMatched;
}

/**
 * Executes the configured action for a blocked sender hit (move to spam/trash,
 * mark as newsletter, or silently ignore).
 */
async function applyBlockedSenderAction(
  userId: string,
  email: {
    id: string;
    accountId: string;
    folderPath: string;
    imapUid: bigint;
    messageId: string | null;
  },
  action: BlockedSenderAction,
) {
  if (action === "move_spam") {
    const { path: targetFolder, newUid } = await moveIndexedEmailToSpecial(email.id, userId, "spam");
    await applyEmailIndexFolderMove(email, targetFolder, newUid);
    return { action, targetFolder };
  }
  if (action === "move_trash") {
    const { path: targetFolder, newUid } = await moveIndexedEmailToSpecial(email.id, userId, "trash");
    await applyEmailIndexFolderMove(email, targetFolder, newUid);
    return { action, targetFolder };
  }
  if (action === "mark_newsletter") {
    await prisma.emailIndex.update({
      where: { id: email.id },
      data: { aiCategory: "newsletter", aiAnalyzed: true },
    });
    return { action };
  }
  return { action: "ignore" };
}

/**
 * Checks all active blocked-sender entries for the user and applies the
 * matching policy (if any) to the given email.
 *
 * @param ctx - Object containing `userId` and `emailId`.
 * @returns An object indicating whether a blocked sender matched and whether the email was moved.
 */
export async function applyBlockedSenderPoliciesForEmail(ctx: { userId: string; emailId: string }) {
  const email = await prisma.emailIndex.findFirst({
    where: {
      id: ctx.emailId,
      account: { userId: ctx.userId },
    },
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      imapUid: true,
      messageId: true,
      fromEmail: true,
    },
  });
  if (!email) {
    throw new Error("Email not found");
  }

  const fromDomain = toDomain(email.fromEmail);
  const blockedEntries = await prisma.blockedSender.findMany({
    where: { userId: ctx.userId, active: true },
    orderBy: { createdAt: "desc" },
  });

  // First match wins — entries are ordered by createdAt desc (newest first)
  const blocked = blockedEntries.find((entry) => {
    const emailMatch =
      !!entry.email && !!email.fromEmail && entry.email.toLowerCase() === email.fromEmail.toLowerCase();
    const domainMatch = domainMatches(entry.domain, fromDomain);
    return emailMatch || domainMatch;
  });

  if (!blocked) {
    return { matched: false, moved: false };
  }

  const blockedResult = await applyBlockedSenderAction(ctx.userId, email, blocked.action);
  await writeAuditLog({
    userId: ctx.userId,
    accountId: email.accountId,
    emailId: email.id,
    action: "blocked_sender.applied",
    actor: "rule",
    beforeJson: { blockedSenderId: blocked.id, action: blocked.action },
    afterJson: blockedResult,
  });

  return {
    matched: true,
    moved: blocked.action === "move_spam" || blocked.action === "move_trash",
    action: blocked.action,
  };
}

/**
 * Executes a single rule action (label, categorize, move, or trigger AI classification)
 * and returns a result object describing what was done.
 */
async function applyRuleAction(action: RuleAction, userId: string, emailId: string) {
  if (action.type === "add_label") {
    // Raw SQL to atomically add label only if not already present (avoids duplicates)
    await prisma.$executeRaw`
      UPDATE "EmailIndex"
      SET "labels" = CASE
        WHEN NOT ("labels" @> ARRAY[${action.value}]::text[])
        THEN array_append("labels", ${action.value})
        ELSE "labels"
      END
      WHERE "id" = ${emailId}
    `;
    return { type: action.type, label: action.value };
  }

  if (action.type === "set_category") {
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { aiCategory: action.value, aiAnalyzed: true },
    });
    return { type: action.type, value: action.value };
  }

  if (action.type === "set_priority") {
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { aiPriority: action.value, aiAnalyzed: true },
    });
    return { type: action.type, value: action.value };
  }

  if (action.type === "move_folder") {
    const email = await prisma.emailIndex.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        accountId: true,
        folderPath: true,
        imapUid: true,
        messageId: true,
      },
    });
    if (!email) throw new Error("Email not found");
    const newUid = await moveIndexedEmail(emailId, userId, action.value);
    await applyEmailIndexFolderMove(email, action.value, newUid);
    return { type: action.type, targetFolder: action.value };
  }

  if (action.type === "move_spam") {
    const email = await prisma.emailIndex.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        accountId: true,
        folderPath: true,
        imapUid: true,
        messageId: true,
      },
    });
    if (!email) throw new Error("Email not found");
    const { path: targetFolder, newUid } = await moveIndexedEmailToSpecial(emailId, userId, "spam");
    await applyEmailIndexFolderMove(email, targetFolder, newUid);
    return { type: action.type, targetFolder };
  }

  if (action.type === "move_trash") {
    const email = await prisma.emailIndex.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        accountId: true,
        folderPath: true,
        imapUid: true,
        messageId: true,
      },
    });
    if (!email) throw new Error("Email not found");
    const { path: targetFolder, newUid } = await moveIndexedEmailToSpecial(emailId, userId, "trash");
    await applyEmailIndexFolderMove(email, targetFolder, newUid);
    return { type: action.type, targetFolder };
  }

  if (action.type === "mark_newsletter") {
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { aiCategory: "newsletter", aiAnalyzed: true },
    });
    return { type: action.type };
  }

  // Fallback: unrecognized action types trigger AI-based classification
  const ai = await runAiClassificationForEmail(emailId, userId);
  return { type: action.type, aiCategory: ai.category, aiPriority: ai.priority };
}

/**
 * Main entry point: runs all active rules for a given email.
 *
 * 1. Optionally applies blocked-sender policies first.
 * 2. Loads rules sorted by ascending priority (lowest number = highest priority).
 * 3. For each rule, validates its JSON schemas, evaluates conditions, and
 *    executes actions on match.
 * 4. Stops early if a matched rule's `stopAfterMatch` flag is set.
 *
 * @param ctx - The rule evaluation context (userId, emailId, options).
 * @returns Summary with total rules checked and how many were applied.
 */
export async function applyRulesForEmail(ctx: RuleContext) {
  const email = await prisma.emailIndex.findFirst({
    where: {
      id: ctx.emailId,
      account: { userId: ctx.userId },
    },
    select: {
      id: true,
      accountId: true,
      folderPath: true,
      fromEmail: true,
      subject: true,
      hasAttachments: true,
      aiCategory: true,
      aiPriority: true,
      aiKeywords: true,
      attachments: {
        select: { filename: true },
      },
    },
  });
  if (!email) {
    throw new Error("Email not found");
  }

  const emailForRules: RuleEmail & { id: string; accountId: string; folderPath: string } = {
    ...email,
    attachmentFilenames: email.attachments
      .map((a) => a.filename)
      .filter((f): f is string => !!f),
  };

  if (!ctx.skipBlockedSender) {
    await applyBlockedSenderPoliciesForEmail({
      userId: ctx.userId,
      emailId: ctx.emailId,
    });
  }

  const rules = await prisma.mailRule.findMany({
    where: { userId: ctx.userId, active: true },
    orderBy: { priority: "asc" },
  });

  let appliedRules = 0;

  for (const rule of rules) {
    const parsedCondition = ruleConditionSchema.safeParse(rule.conditionJson);
    const parsedAction = ruleActionContainerSchema.safeParse(rule.actionJson);

    // Skip rules with invalid/corrupted JSON schemas and log for diagnostics
    if (!parsedCondition.success || !parsedAction.success) {
      await writeAuditLog({
        userId: ctx.userId,
        accountId: emailForRules.accountId,
        emailId: ctx.emailId,
        action: "rule.invalid",
        actor: "rule",
        beforeJson: { ruleId: rule.id },
        afterJson: {
          conditionValid: parsedCondition.success,
          actionValid: parsedAction.success,
        },
      });
      continue;
    }

    const matched = evaluateRuleCondition(parsedCondition.data, emailForRules);
    if (!matched) {
      await writeAuditLog({
        userId: ctx.userId,
        accountId: emailForRules.accountId,
        emailId: ctx.emailId,
        action: "rule.checked",
        actor: "rule",
        beforeJson: { ruleId: rule.id },
        afterJson: { applied: false },
      });
      continue;
    }

    const actionResults: Array<Record<string, unknown>> = [];
    for (const action of parsedAction.data.actions) {
      const result = await applyRuleAction(action, ctx.userId, ctx.emailId);
      actionResults.push(result);
    }

    appliedRules += 1;
    await writeAuditLog({
      userId: ctx.userId,
      accountId: emailForRules.accountId,
      emailId: ctx.emailId,
      action: "rule.applied",
      actor: "rule",
      beforeJson: { ruleId: rule.id },
      afterJson: { applied: true, actionResults },
    });

    // Short-circuit: stop evaluating further rules if this rule requests it
    if (parsedAction.data.stopAfterMatch) {
      break;
    }
  }

  return { checkedRules: rules.length, appliedRules };
}
