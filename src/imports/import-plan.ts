import { createHash } from 'node:crypto';
import { FieldError } from './import-item.entity';
import { RecordValidation, ValidRecord } from './record-validation';

// Fingerprint of what a record says (not who it is): tells a duplicate
// (same content) from a conflict (same source + externalId, other content).
export function contentHash(r: ValidRecord): string {
  return createHash('sha256')
    .update(JSON.stringify([r.title, r.description, r.date.toISOString()]))
    .digest('hex');
}

// Identity of a record: unique (source, external_id) in the DB.
export const recordKey = (r: { source: string; externalId: string }): string =>
  JSON.stringify([r.source, r.externalId]);

export type PlannedItem =
  | {
      index: number;
      kind: 'invalid';
      errors: FieldError[];
      externalId: string | null;
      source: string | null;
    }
  | { index: number; kind: 'new'; record: ValidRecord; hash: string }
  | {
      index: number;
      kind: 'repeat';
      // Index of the first valid copy in this batch.
      of: number;
      sameContent: boolean;
      record: ValidRecord;
      hash: string;
    };

// Sorts each submitted item into invalid / first copy / later copy.
export function planImport(validations: RecordValidation[]): PlannedItem[] {
  const firstByKey = new Map<string, { index: number; hash: string }>();

  return validations.map((v, index): PlannedItem => {
    if (!v.ok) {
      return {
        index,
        kind: 'invalid',
        errors: v.errors,
        externalId: v.externalId,
        source: v.source,
      };
    }
    const hash = contentHash(v.record);
    const key = recordKey(v.record);
    const first = firstByKey.get(key);
    if (first) {
      return {
        index,
        kind: 'repeat',
        of: first.index,
        sameContent: first.hash === hash,
        record: v.record,
        hash,
      };
    }
    firstByKey.set(key, { index, hash });
    return { index, kind: 'new', record: v.record, hash };
  });
}
