import { CATEGORIES, Category } from '../classification/categories';
import { InvalidBodyError } from '../common/errors';

export const MAX_REASON_LENGTH = 1000;

export interface CorrectionInput {
  category: Category;
  reason: string;
}

// { category, reason }: category from the fixed list, reason required.
export function parseCorrectionBody(body: unknown): CorrectionInput {
  const b =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as { [k: string]: unknown })
      : {};

  if (!(CATEGORIES as readonly unknown[]).includes(b.category)) {
    throw new InvalidBodyError(
      `category must be one of: ${CATEGORIES.join(', ')}`,
    );
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason === '' || [...reason].length > MAX_REASON_LENGTH) {
    throw new InvalidBodyError(
      `reason is required (1 to ${MAX_REASON_LENGTH} characters)`,
    );
  }
  return { category: b.category as Category, reason };
}
