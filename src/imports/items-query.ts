import { InvalidQueryError } from '../common/errors';
import { ITEM_OUTCOMES, ItemOutcome } from './import-item.entity';
import { MAX_RECORDS_PER_IMPORT } from './record-validation';

export const DEFAULT_PAGE_LIMIT = 100;
// One page can hold a whole import.
export const MAX_PAGE_LIMIT = MAX_RECORDS_PER_IMPORT;

export interface ItemsQuery {
  outcome: ItemOutcome | undefined;
  limit: number;
  offset: number;
}

type RawQuery = { [k: string]: unknown };

// Express gives a string, or an array when the param is repeated.
function single(query: RawQuery, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidQueryError(`${name} must be given once`);
  }
  return value;
}

function integer(
  query: RawQuery,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = single(query, name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new InvalidQueryError(
      `${name} must be a whole number from ${min} to ${max}`,
    );
  }
  return Number(value);
}

export function parseItemsQuery(query: RawQuery): ItemsQuery {
  const outcome = single(query, 'outcome');
  if (
    outcome !== undefined &&
    !(ITEM_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    throw new InvalidQueryError(
      `outcome must be one of: ${ITEM_OUTCOMES.join(', ')}`,
    );
  }
  return {
    outcome: outcome as ItemOutcome | undefined,
    limit: integer(query, 'limit', DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT),
    offset: integer(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
