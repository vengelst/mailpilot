/**
 * @module blockedSenderJob
 *
 * Applies blocked-sender policies to a batch of emails. For each email,
 * delegates to the rules engine which checks if the sender is on the user's
 * blocklist and moves matching emails to the configured target folder.
 */

import { applyBlockedSenderPoliciesForEmail } from "@/server/rules/rulesEngine";

/**
 * Evaluates a list of emails against the user's blocked-sender rules.
 * Each email is checked individually; matches are moved via IMAP.
 *
 * @param input.userId - Owner of the mailbox
 * @param input.emailIds - Email IDs to evaluate
 * @returns Summary with total processed, matched, and successfully moved counts
 */
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
