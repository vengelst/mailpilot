import { prisma } from "@/server/db/prisma";
import { getSessionFromCookies } from "@/server/auth/session";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return fail("Unauthorized", 401);

  try {
    const emails = await prisma.emailIndex.findMany({
      where: {
        account: { userId: session.userId },
        aiCategory: { not: null },
      },
      select: {
        aiCategory: true,
        folderPath: true,
      },
    });

    const categoryMap = new Map<string, Set<string>>();
    const categoryCounts = new Map<string, number>();

    for (const email of emails) {
      const cat = email.aiCategory;
      if (!cat) continue;
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      if (!categoryMap.has(cat)) categoryMap.set(cat, new Set());
      categoryMap.get(cat)!.add(email.folderPath);
    }

    const suggestions: Array<{
      description: string;
      condition: { all: Array<{ field: string; operator: string; value: string }> };
      action: { actions: Array<{ type: string; value?: string }> };
      affectedCount: number;
      folderCount: number;
      category: string;
    }> = [];

    for (const [category, folders] of categoryMap.entries()) {
      const count = categoryCounts.get(category) ?? 0;
      if (count < 5 || folders.size < 2) continue;

      const folderName = category.charAt(0).toUpperCase() + category.slice(1);
      suggestions.push({
        description: `${count} E-Mails mit Kategorie "${category}" befinden sich in ${folders.size} verschiedenen Ordnern. Vorschlag: Alle in "${folderName}" verschieben.`,
        condition: {
          all: [{ field: "aiCategory", operator: "equals", value: category }],
        },
        action: {
          actions: [{ type: "move_folder", value: folderName }],
        },
        affectedCount: count,
        folderCount: folders.size,
        category,
      });
    }

    suggestions.sort((a, b) => b.affectedCount - a.affectedCount);

    return ok({ suggestions });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Suggestions failed", 500);
  }
}
