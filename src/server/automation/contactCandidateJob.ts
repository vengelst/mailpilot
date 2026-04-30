import { prisma } from "@/server/db/prisma";

export async function runContactCandidateJob(input: {
  userId: string;
  accountId?: string;
  emailIds: string[];
}) {
  if (!input.emailIds.length) {
    return { pendingCandidates: 0, totalCandidates: 0 };
  }

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
