import { z } from "zod";

const ruleFieldSchema = z.enum([
  "fromEmail",
  "fromDomain",
  "subject",
  "hasAttachments",
  "aiCategory",
  "aiPriority",
  "keywords",
]);

const stringOperatorSchema = z.enum(["equals", "contains", "endsWith"]);

const fromDomainConditionSchema = z
  .object({
    field: z.literal("fromDomain"),
    operator: z.literal("equals"),
    value: z.string().min(1),
  })
  .strict();

const hasAttachmentsConditionSchema = z
  .object({
    field: z.literal("hasAttachments"),
    operator: z.literal("equals"),
    value: z.boolean(),
  })
  .strict();

const subjectConditionSchema = z
  .object({
    field: z.literal("subject"),
    operator: z.literal("contains"),
    value: z.string().min(1),
  })
  .strict();

const stringBasedConditionSchema = z
  .object({
    field: ruleFieldSchema.exclude(["fromDomain", "hasAttachments", "subject"]),
    operator: stringOperatorSchema,
    value: z.string().min(1),
  })
  .strict();

export const ruleLeafConditionSchema = z.union([
  fromDomainConditionSchema,
  hasAttachmentsConditionSchema,
  subjectConditionSchema,
  stringBasedConditionSchema,
]);

export type RuleLeafCondition = z.infer<typeof ruleLeafConditionSchema>;

export type RuleConditionGroup = {
  all?: RuleConditionNode[];
  any?: RuleConditionNode[];
};

export type RuleConditionNode = RuleLeafCondition | RuleConditionGroup;

export const ruleConditionNodeSchema: z.ZodType<RuleConditionNode> = z.lazy(() =>
  z.union([
    ruleLeafConditionSchema,
    z
      .object({
        all: z.array(ruleConditionNodeSchema).optional(),
        any: z.array(ruleConditionNodeSchema).optional(),
      })
      .strict()
      .refine((value) => (value.all?.length ?? 0) > 0 || (value.any?.length ?? 0) > 0, {
        message: "Condition group must contain all or any",
      }),
  ]),
);

export const ruleConditionSchema = z
  .object({
    all: z.array(ruleConditionNodeSchema).optional(),
    any: z.array(ruleConditionNodeSchema).optional(),
  })
  .strict()
  .refine((value) => (value.all?.length ?? 0) > 0 || (value.any?.length ?? 0) > 0, {
    message: "Rule conditions require all or any",
  });

export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_category"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("set_priority"), value: z.enum(["low", "normal", "high", "urgent"]) }).strict(),
  z.object({ type: z.literal("move_folder"), value: z.string().min(1) }).strict(),
  z.object({ type: z.literal("move_spam") }).strict(),
  z.object({ type: z.literal("move_trash") }).strict(),
  z.object({ type: z.literal("mark_newsletter") }).strict(),
  z.object({ type: z.literal("queue_ai_analysis") }).strict(),
]);

export const ruleActionContainerSchema = z
  .object({
    actions: z.array(ruleActionSchema).min(1),
    stopAfterMatch: z.boolean().optional(),
  })
  .strict();

export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type RuleAction = z.infer<typeof ruleActionSchema>;
export type RuleActionContainer = z.infer<typeof ruleActionContainerSchema>;
