import { prisma } from "@/server/db/prisma";
import { BlockedSenderAction } from "@prisma/client";
import { writeAuditLog } from "@/server/audit/auditLog";
import { moveIndexedEmail, moveIndexedEmailToSpecial } from "@/server/imap/imapService";
import { runAiClassificationForEmail } from "@/server/automation/aiClassificationJob";
import {
  RuleAction,
  RuleCondition,
  RuleConditionNode,
  ruleActionContainerSchema,
  ruleConditionSchema,
} from "@/server/rules/schemas";

type RuleContext = {
  userId: string;
  emailId: string;
  skipBlockedSender?: boolean;
};

function toDomain(email?: string | null) {
  if (!email || !email.includes("@")) return "";
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function domainMatches(blockedDomain?: string | null, senderDomain?: string) {
  if (!blockedDomain || !senderDomain) return false;
  const blocked = blockedDomain.toLowerCase();
  const sender = senderDomain.toLowerCase();
  return sender === blocked || sender.endsWith(`.${blocked}`);
}

function stringOp(left: string, operator: "equals" | "contains" | "endsWith", right: string) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (operator === "equals") return a === b;
  if (operator === "endsWith") return a.endsWith(b);
  return a.includes(b);
}

function evaluateLeaf(
  condition: Exclude<RuleConditionNode, { all?: RuleConditionNode[]; any?: RuleConditionNode[] }>,
  email: {
    fromEmail?: string | null;
    subject?: string | null;
    hasAttachments: boolean;
    aiCategory?: string | null;
    aiPriority?: string | null;
    aiKeywords: string[];
  },
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

function evaluateNode(
  node: RuleConditionNode,
  email: {
    fromEmail?: string | null;
    subject?: string | null;
    hasAttachments: boolean;
    aiCategory?: string | null;
    aiPriority?: string | null;
    aiKeywords: string[];
  },
): boolean {
  if ("field" in node) {
    return evaluateLeaf(node, email);
  }

  const allMatched = node.all ? node.all.every((child) => evaluateNode(child, email)) : true;
  const anyMatched = node.any ? node.any.some((child) => evaluateNode(child, email)) : true;
  return allMatched && anyMatched;
}

function evaluateRuleCondition(
  condition: RuleCondition,
  email: {
    fromEmail?: string | null;
    subject?: string | null;
    hasAttachments: boolean;
    aiCategory?: string | null;
    aiPriority?: string | null;
    aiKeywords: string[];
  },
): boolean {
  const allMatched = condition.all ? condition.all.every((node) => evaluateNode(node, email)) : true;
  const anyMatched = condition.any ? condition.any.some((node) => evaluateNode(node, email)) : true;
  return allMatched && anyMatched;
}

async function applyBlockedSenderAction(
  userId: string,
  email: { id: string; accountId: string; folderPath: string },
  action: BlockedSenderAction,
) {
  if (action === "move_spam") {
    const targetFolder = await moveIndexedEmailToSpecial(email.id, userId, "spam");
    await prisma.emailIndex.update({ where: { id: email.id }, data: { folderPath: targetFolder } });
    return { action, targetFolder };
  }
  if (action === "move_trash") {
    const targetFolder = await moveIndexedEmailToSpecial(email.id, userId, "trash");
    await prisma.emailIndex.update({ where: { id: email.id }, data: { folderPath: targetFolder } });
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

async function applyRuleAction(action: RuleAction, userId: string, emailId: string) {
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
    await moveIndexedEmail(emailId, userId, action.value);
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { folderPath: action.value },
    });
    return { type: action.type, targetFolder: action.value };
  }

  if (action.type === "move_spam") {
    const targetFolder = await moveIndexedEmailToSpecial(emailId, userId, "spam");
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { folderPath: targetFolder },
    });
    return { type: action.type, targetFolder };
  }

  if (action.type === "move_trash") {
    const targetFolder = await moveIndexedEmailToSpecial(emailId, userId, "trash");
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { folderPath: targetFolder },
    });
    return { type: action.type, targetFolder };
  }

  if (action.type === "mark_newsletter") {
    await prisma.emailIndex.update({
      where: { id: emailId },
      data: { aiCategory: "newsletter", aiAnalyzed: true },
    });
    return { type: action.type };
  }

  const ai = await runAiClassificationForEmail(emailId, userId);
  return { type: action.type, aiCategory: ai.category, aiPriority: ai.priority };
}

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
    },
  });
  if (!email) {
    throw new Error("Email not found");
  }

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

    if (!parsedCondition.success || !parsedAction.success) {
      await writeAuditLog({
        userId: ctx.userId,
        accountId: email.accountId,
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

    const matched = evaluateRuleCondition(parsedCondition.data, email);
    if (!matched) {
      await writeAuditLog({
        userId: ctx.userId,
        accountId: email.accountId,
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
      accountId: email.accountId,
      emailId: ctx.emailId,
      action: "rule.applied",
      actor: "rule",
      beforeJson: { ruleId: rule.id },
      afterJson: { applied: true, actionResults },
    });

    if (parsedAction.data.stopAfterMatch) {
      break;
    }
  }

  return { checkedRules: rules.length, appliedRules };
}
