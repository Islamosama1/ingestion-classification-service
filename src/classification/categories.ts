// Allowed categories. The DB enforces the same list (CHK_classifications_category);
// changing it needs a migration.
export const CATEGORIES = [
  'sports',
  'culture',
  'education',
  'business',
  'health',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];
