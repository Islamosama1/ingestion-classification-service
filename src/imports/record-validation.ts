import { FieldError } from './import-item.entity';

export const MAX_RECORDS_PER_IMPORT = 1000;

// Same limits as the records table columns.
const TEXT_FIELDS = [
  ['externalId', 255],
  ['source', 100],
  ['title', 200],
  ['description', 5000],
] as const;

export interface ValidRecord {
  externalId: string;
  source: string;
  title: string;
  description: string;
  date: Date;
}

export type RecordValidation =
  | { ok: true; record: ValidRecord }
  | {
      ok: false;
      errors: FieldError[];
      // Kept so the client can tell which record failed.
      externalId: string | null;
      source: string | null;
    };

// The whole request is unusable (not just some records in it).
export class InvalidBatchError extends Error {}

// YYYY-MM-DD, or a full date-time that must carry a time zone.
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2})))?$/;

const DATE_MESSAGE =
  'date must be an ISO 8601 date (2026-07-01) or date-time with time zone (2026-07-01T10:30:00Z)';

export function parseIsoDate(value: string): Date | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, oh, om] = m.map(Number);

  // Rejects 2026-02-30 etc. (it would roll over to March). setUTCFullYear,
  // unlike Date.UTC, doesn't map years 0-99 to 1900-1999.
  const day = new Date(0);
  day.setUTCFullYear(y, mo - 1, d);
  if (
    day.getUTCFullYear() !== y ||
    day.getUTCMonth() !== mo - 1 ||
    day.getUTCDate() !== d
  ) {
    return null;
  }
  if (m[4] === undefined) return day;

  if (h > 23 || mi > 59 || s > 59) return null;
  if (m[8] !== undefined && (oh > 23 || om > 59)) return null;
  return new Date(value);
}

const isObject = (v: unknown): v is { [k: string]: unknown } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Checks one required string field; pushes at most one error.
function readText(
  raw: { [k: string]: unknown },
  field: string,
  errors: FieldError[],
): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null) {
    errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} must be a string` });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  return trimmed;
}

// Code points, like Postgres varchar(n), not UTF-16 units.
const length = (s: string): number => [...s].length;

export function validateRecord(raw: unknown): RecordValidation {
  if (!isObject(raw)) {
    return {
      ok: false,
      errors: [{ field: 'record', message: 'record must be an object' }],
      externalId: null,
      source: null,
    };
  }

  const errors: FieldError[] = [];
  const values: { [k: string]: string | undefined } = {};
  for (const [field, max] of TEXT_FIELDS) {
    const value = readText(raw, field, errors);
    if (value !== undefined && length(value) > max) {
      errors.push({
        field,
        message: `${field} must be at most ${max} characters`,
      });
      continue;
    }
    values[field] = value;
  }

  const dateText = readText(raw, 'date', errors);
  const date = dateText === undefined ? null : parseIsoDate(dateText);
  if (dateText !== undefined && date === null) {
    errors.push({ field: 'date', message: DATE_MESSAGE });
  }

  if (errors.length > 0 || date === null) {
    const rawText = (field: string) =>
      typeof raw[field] === 'string' ? (raw[field] as string).trim() : null;
    return {
      ok: false,
      errors,
      externalId: rawText('externalId'),
      source: rawText('source'),
    };
  }

  return {
    ok: true,
    record: {
      externalId: values.externalId!,
      source: values.source!,
      title: values.title!,
      description: values.description!,
      date,
    },
  };
}

// Checks the request shape and size; records are checked one by one later.
export function parseImportBody(body: unknown): unknown[] {
  if (!isObject(body)) {
    throw new InvalidBatchError(
      'Body must be a JSON object with a "records" array',
    );
  }
  const { records } = body;
  if (!Array.isArray(records)) {
    throw new InvalidBatchError('"records" must be an array');
  }
  if (records.length === 0) {
    throw new InvalidBatchError('"records" must contain at least 1 record');
  }
  if (records.length > MAX_RECORDS_PER_IMPORT) {
    throw new InvalidBatchError(
      `"records" must contain at most ${MAX_RECORDS_PER_IMPORT} records`,
    );
  }
  return records;
}
