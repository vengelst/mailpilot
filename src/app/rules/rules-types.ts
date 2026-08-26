export type RuleRow = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  conditionJson: unknown;
  actionJson: unknown;
};

export type CategoryInfo = { name: string; count: number };
export type FolderInfo = { path: string; count: number };

export type LeafCondition = {
  field: string;
  operator: string;
  value: string | boolean;
};

export type RuleActionItem = {
  type: string;
  value?: string;
};

export type Suggestion = {
  description: string;
  condition: unknown;
  action: unknown;
  affectedCount: number;
  folderCount: number;
  category: string;
};

export type PreviewResult = {
  count: number;
  sample: Array<{
    id: string;
    subject: string | null;
    fromEmail: string | null;
    fromName: string | null;
    folderPath: string;
    date: string | null;
  }>;
};
