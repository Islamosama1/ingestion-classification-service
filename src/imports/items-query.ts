import { RawQuery, integer, oneOf } from '../common/query';
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

export function parseItemsQuery(query: RawQuery): ItemsQuery {
  return {
    outcome: oneOf(query, 'outcome', ITEM_OUTCOMES),
    limit: integer(query, 'limit', DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT),
    offset: integer(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
