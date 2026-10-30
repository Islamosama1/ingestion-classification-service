import { CATEGORIES, Category } from '../classification/categories';
import { InvalidQueryError, isUuid } from '../common/errors';
import { RawQuery, integer, oneOf, single, text } from '../common/query';
import { parseIsoDate } from '../imports/record-validation';
import { CLASS_STATUSES, ClassStatus } from './record.entity';

export const RECORDS_DEFAULT_LIMIT = 50;
export const RECORDS_MAX_LIMIT = 200;

export interface RecordsQuery {
  source: string | undefined;
  category: Category | undefined;
  status: ClassStatus | undefined;
  needsReview: boolean | undefined;
  importId: string | undefined;
  // Record date range: from (inclusive) up to toBefore (exclusive).
  from: Date | undefined;
  toBefore: Date | undefined;
  q: string | undefined;
  limit: number;
  offset: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function date(query: RawQuery, name: string): Date | undefined {
  const value = single(query, name)?.trim();
  if (value === undefined) return undefined;
  const parsed = parseIsoDate(value);
  if (!parsed) {
    throw new InvalidQueryError(
      `${name} must be an ISO 8601 date (2026-07-01) or date-time with time zone`,
    );
  }
  return parsed;
}

export function parseRecordsQuery(query: RawQuery): RecordsQuery {
  const needsReview = oneOf(query, 'needsReview', ['true', 'false'] as const);
  const importId = single(query, 'importId');
  if (importId !== undefined && !isUuid(importId)) {
    throw new InvalidQueryError('importId must be a UUID');
  }

  const from = date(query, 'from');
  const to = date(query, 'to');
  if (from && to && from > to) {
    throw new InvalidQueryError('from must not be after to');
  }
  // "to" is inclusive: a date-only value covers that whole day.
  const rawTo = single(query, 'to')?.trim();
  const toBefore =
    to && rawTo
      ? new Date(to.getTime() + (rawTo.length === 10 ? DAY_MS : 1))
      : undefined;

  return {
    source: text(query, 'source', 100),
    category: oneOf(query, 'category', CATEGORIES),
    status: oneOf(query, 'status', CLASS_STATUSES),
    needsReview: needsReview === undefined ? undefined : needsReview === 'true',
    importId,
    from,
    toBefore,
    q: text(query, 'q', 200),
    limit: integer(query, 'limit', RECORDS_DEFAULT_LIMIT, 1, RECORDS_MAX_LIMIT),
    offset: integer(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
