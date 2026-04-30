import { applyBlockedSenderPoliciesForEmail } from "@/server/rules/rulesEngine";

export async function runBlockedSenderJob(input: { userId: string; emailIds: string[] }) {
  let matched = 0;
  let moved = 0;
  for (const emailId of input.emailIds) {
    const result = await applyBlockedSenderPoliciesForEmail({
      userId: input.userId,
      emailId,
    });
    if (result.matched) matched += 1;
    if (result.moved) moved += 1;
  }
  return {
    processedEmails: input.emailIds.length,
    matched,
    moved,
  };
}
