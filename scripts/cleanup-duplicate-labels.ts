/**
 * Cleanup script: Remove duplicate labels from EmailIndex entries.
 *
 * Run inside the app container:
 *   npx tsx scripts/cleanup-duplicate-labels.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const emailsWithLabels = await prisma.emailIndex.findMany({
    where: { labels: { isEmpty: false } },
    select: { id: true, labels: true },
  });

  let fixed = 0;

  for (const email of emailsWithLabels) {
    const unique = [...new Set(email.labels)];
    if (unique.length < email.labels.length) {
      await prisma.emailIndex.update({
        where: { id: email.id },
        data: { labels: unique },
      });
      fixed++;
      console.log(
        `Fixed email ${email.id}: ${email.labels.length} labels → ${unique.length} (removed ${email.labels.length - unique.length} duplicates)`,
      );
    }
  }

  console.log(`\nDone. Fixed ${fixed} of ${emailsWithLabels.length} emails with labels.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
