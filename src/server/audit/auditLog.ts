import { AuditActor } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

type AuditInput = {
  userId?: string | null;
  accountId?: string | null;
  emailId?: string | null;
  action: string;
  actor: AuditActor;
  beforeJson?: unknown;
  afterJson?: unknown;
};

/**
 * Recursively normalize values for AuditLog JSON storage:
 * - BigInt → string (so JSON.stringify won't crash and Prisma JSON columns accept it)
 * - Date   → ISO string
 * - other  → unchanged
 *
 * Caller responsibility: do not pass mailtexts, passwords, tokens or API keys.
 */
export function sanitizeAuditJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeAuditJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        sanitizeAuditJson(val),
      ]),
    );
  }
  return value;
}

export async function writeAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      accountId: input.accountId ?? null,
      emailId: input.emailId ?? null,
      action: input.action,
      actor: input.actor,
      beforeJson: sanitizeAuditJson(input.beforeJson) as object | undefined,
      afterJson: sanitizeAuditJson(input.afterJson) as object | undefined,
    },
  });
}
