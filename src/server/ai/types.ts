import { z } from "zod";

export const aiCategorySchema = z.enum([
  "invoice",
  "offer",
  "customer",
  "support",
  "contract",
  "private",
  "newsletter",
  "spam",
  "unknown",
]);

export const aiPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const aiRecommendedActionSchema = z.enum([
  "none",
  "move",
  "mark_spam",
  "move_trash",
  "create_contact_candidate",
  "save_attachment",
]);

export const aiDetectedContactSchema = z
  .object({
    companyName: z.string().optional(),
    personName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const aiTaskSchema = z
  .object({
    title: z.string().min(1),
    dueDate: z.string().optional(),
    priority: aiPrioritySchema.optional(),
  })
  .strict();

export const aiResultSchema = z.object({
  summaryShort: z.string(),
  summaryLong: z.string(),
  category: aiCategorySchema,
  priority: aiPrioritySchema,
  actionRequired: z.boolean(),
  recommendedFolder: z.string().optional(),
  recommendedAction: aiRecommendedActionSchema,
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()),
  detectedContacts: z.array(aiDetectedContactSchema),
  tasks: z.array(aiTaskSchema),
}).strict();

export type AiResult = z.infer<typeof aiResultSchema>;

export type AiAnalyzeInput = {
  subject?: string | null;
  from?: string | null;
  body?: string | null;
};

export interface AiProvider {
  analyzeEmail(input: AiAnalyzeInput): Promise<AiResult>;
}
