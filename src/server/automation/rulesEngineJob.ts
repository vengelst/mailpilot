import { applyRulesForEmail } from "@/server/rules/rulesEngine";

export async function runRulesEngineJob(userId: string, emailId: string) {
  return applyRulesForEmail({ userId, emailId, skipBlockedSender: true });
}

export async function runRulesEngineBatchJob(input: { userId: string; emailIds: string[] }) {
  let appliedRules = 0;
  let checkedRules = 0;
  for (const emailId of input.emailIds) {
    const result = await runRulesEngineJob(input.userId, emailId);
    appliedRules += result.appliedRules;
    checkedRules += result.checkedRules;
  }
  return {
    processedEmails: input.emailIds.length,
    appliedRules,
    checkedRules,
  };
}
