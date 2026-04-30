import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/audit/auditLog";
import { createContactsProvider } from "@/server/contacts/providers";

async function getUserScopedCandidate(id: string, userId: string) {
  return prisma.contactCandidate.findFirst({
    where: {
      id,
      emailIndex: {
        account: {
          userId,
        },
      },
    },
    include: {
      emailIndex: {
        select: {
          accountId: true,
        },
      },
    },
  });
}

export async function exportContactCandidateToGoogle(input: { id: string; userId: string }) {
  const candidate = await getUserScopedCandidate(input.id, input.userId);
  if (!candidate) throw new Error("Contact candidate not found");

  const prismaAny = prisma as unknown as {
    cloudAccount: {
      findFirst: (args: unknown) => Promise<{ encryptedAccessToken: string } | null>;
    };
  };
  const googleAccount = await prismaAny.cloudAccount.findFirst({
    where: {
      userId: input.userId,
      provider: "google_drive",
    },
  });

  const providerMode = googleAccount ? "google" : "mock";
  const provider = createContactsProvider({
    mode: providerMode,
    encryptedAccessToken: googleAccount?.encryptedAccessToken,
  });

  const exported = await provider.createContact({
    companyName: candidate.companyName,
    personName: candidate.personName,
    email: candidate.email,
    phone: candidate.phone,
    address: candidate.address,
  });

  const updated = await prisma.contactCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "exported",
      googleContactId: exported.contactId,
    },
  });

  await writeAuditLog({
    userId: input.userId,
    accountId: candidate.emailIndex.accountId,
    emailId: candidate.emailId,
    action: "contact_candidate.exported_google",
    actor: "user",
    beforeJson: { contactCandidateId: candidate.id, status: candidate.status },
    afterJson: {
      contactCandidateId: updated.id,
      status: updated.status,
      provider: exported.provider,
      googleContactId: updated.googleContactId,
    },
  });

  return updated;
}

export async function updateContactCandidateStatus(input: {
  id: string;
  userId: string;
  status: "ignored" | "duplicate";
}) {
  const candidate = await getUserScopedCandidate(input.id, input.userId);
  if (!candidate) throw new Error("Contact candidate not found");

  const updated = await prisma.contactCandidate.update({
    where: { id: candidate.id },
    data: { status: input.status },
  });

  await writeAuditLog({
    userId: input.userId,
    accountId: candidate.emailIndex.accountId,
    emailId: candidate.emailId,
    action: input.status === "ignored" ? "contact_candidate.ignored" : "contact_candidate.duplicate",
    actor: "user",
    beforeJson: { contactCandidateId: candidate.id, status: candidate.status },
    afterJson: { contactCandidateId: updated.id, status: updated.status },
  });

  return updated;
}
