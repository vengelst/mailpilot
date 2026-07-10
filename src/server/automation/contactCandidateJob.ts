/**
 * @module contactCandidateJob
 *
 * Post-classification job that counts pending and total contact candidates
 * extracted from a set of emails by the AI analysis step. Used by the
 * automation pipeline to report how many new contacts await user review.
 */

import { prisma } from "@/server/db/prisma";

/**
 * Counts contact candidates associated with the given email IDs.
 * Distinguishes between pending (unreviewed) and total candidates.
 *
 * @param input.userId - Owner of the mailbox (used for access-control scoping)
 * @param input.accountId - Optional account filter for multi-account users
 * @param input.emailIds - Email IDs whose candidates should be counted
 * @returns Object with pendingCandidates and totalCandidates counts
 */
export async function runContactCandidateJob(input: {
  userId: string;
  accountId?: string;
  emailIds: string[];
}) {
  if (!input.emailIds.length) {
    return { pendingCandidates: 0, totalCandidates: 0 };
  }

  // Scope query to emails owned by this user (and optionally a specific account)
  const where = {
    emailId: { in: input.emailIds },
    emailIndex: {
      account: {
        userId: input.userId,
        ...(input.accountId ? { id: input.accountId } : {}),
      },
    },
  };

  const [pendingCandidates, totalCandidates] = await Promise.all([
    prisma.contactCandidate.count({
      where: {
        ...where,
        status: "pending",
      },
    }),
    prisma.contactCandidate.count({ where }),
  ]);

  return { pendingCandidates, totalCandidates };
}
