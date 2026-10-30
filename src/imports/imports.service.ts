import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FieldError, ItemOutcome } from './import-item.entity';
import { ImportStatus } from './import.entity';
import { PlannedItem, planImport, recordKey } from './import-plan';
import { validateRecord } from './record-validation';

export interface ImportItemResult {
  index: number;
  outcome: ItemOutcome;
  externalId: string | null;
  source: string | null;
  recordId: string | null;
  errors?: FieldError[];
}

export interface ImportResult {
  importId: string;
  status: ImportStatus;
  total: number;
  created: number;
  duplicate: number;
  conflict: number;
  invalid: number;
  items: ImportItemResult[];
}

interface StoredRecord {
  id: string;
  hash: string;
  // Inserted by this import (vs. already there).
  createdHere: boolean;
}

@Injectable()
export class ImportsService {
  constructor(private readonly dataSource: DataSource) {}

  // One transaction: the import, its new records and its feedback rows are
  // saved together or not at all.
  async create(rawRecords: unknown[]): Promise<ImportResult> {
    const plan = planImport(rawRecords.map(validateRecord));

    return this.dataSource.transaction(async (m) => {
      const [{ id: importId }] = await m.query(
        `INSERT INTO imports (total) VALUES ($1) RETURNING id`,
        [rawRecords.length],
      );

      const stored = await this.storeNewRecords(m, importId, plan);
      const items = plan.map((p) => this.toResult(p, stored));
      await this.saveItems(m, importId, items);

      const counts = {
        created: 0,
        duplicate: 0,
        conflict: 0,
        invalid: 0,
      };
      for (const item of items) counts[item.outcome]++;
      const status: ImportStatus =
        counts.created > 0 ? 'processing' : 'completed';

      await m.query(
        `UPDATE imports SET status = $2, created_count = $3, duplicate_count = $4,
           conflict_count = $5, invalid_count = $6, updated_at = now()
         WHERE id = $1`,
        [
          importId,
          status,
          counts.created,
          counts.duplicate,
          counts.conflict,
          counts.invalid,
        ],
      );

      return { importId, status, total: rawRecords.length, ...counts, items };
    });
  }

  // Inserts first copies; a row that already exists (from an earlier or a
  // concurrent import) is skipped by the unique key, never overwritten.
  private async storeNewRecords(
    m: EntityManager,
    importId: string,
    plan: PlannedItem[],
  ): Promise<Map<string, StoredRecord>> {
    const fresh = plan.flatMap((p) => (p.kind === 'new' ? [p] : []));
    const stored = new Map<string, StoredRecord>();
    if (fresh.length === 0) return stored;

    // Same insert order in every transaction, so concurrent imports of
    // overlapping records wait for each other instead of deadlocking.
    fresh.sort((a, b) => (recordKey(a.record) < recordKey(b.record) ? -1 : 1));
    const col = <T>(pick: (p: (typeof fresh)[number]) => T): T[] =>
      fresh.map(pick);

    const inserted: { id: string; source: string; external_id: string }[] =
      await m.query(
        `INSERT INTO records
           (source, external_id, title, description, effective_date, content_hash, import_id)
         SELECT s, e, t, d, dt, h, $7
         FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[],
                     $5::timestamptz[], $6::char(64)[]) AS u(s, e, t, d, dt, h)
         ON CONFLICT (source, external_id) DO NOTHING
         RETURNING id, source, external_id`,
        [
          col((p) => p.record.source),
          col((p) => p.record.externalId),
          col((p) => p.record.title),
          col((p) => p.record.description),
          col((p) => p.record.date.toISOString()),
          col((p) => p.hash),
          importId,
        ],
      );
    const hashByKey = new Map(fresh.map((p) => [recordKey(p.record), p.hash]));
    for (const r of inserted) {
      const key = recordKey({ source: r.source, externalId: r.external_id });
      stored.set(key, {
        id: r.id,
        hash: hashByKey.get(key)!,
        createdHere: true,
      });
    }

    const existing = fresh.filter((p) => !stored.has(recordKey(p.record)));
    if (existing.length > 0) {
      const rows: {
        id: string;
        source: string;
        external_id: string;
        content_hash: string;
      }[] = await m.query(
        `SELECT r.id, r.source, r.external_id, r.content_hash
         FROM records r
         JOIN unnest($1::varchar[], $2::varchar[]) AS k(s, e)
           ON r.source = k.s AND r.external_id = k.e`,
        [
          existing.map((p) => p.record.source),
          existing.map((p) => p.record.externalId),
        ],
      );
      for (const r of rows) {
        stored.set(recordKey({ source: r.source, externalId: r.external_id }), {
          id: r.id,
          hash: r.content_hash,
          createdHere: false,
        });
      }
    }
    return stored;
  }

  private toResult(
    p: PlannedItem,
    stored: Map<string, StoredRecord>,
  ): ImportItemResult {
    if (p.kind === 'invalid') {
      return {
        index: p.index,
        outcome: 'invalid',
        externalId: p.externalId,
        source: p.source,
        recordId: null,
        errors: p.errors,
      };
    }
    const target = stored.get(recordKey(p.record))!;
    // Duplicate vs conflict is judged against the stored record, which may
    // be an older one, not just against the first copy in this batch.
    let outcome: ItemOutcome;
    if (p.kind === 'new' && target.createdHere) outcome = 'created';
    else outcome = target.hash === p.hash ? 'duplicate' : 'conflict';
    return {
      index: p.index,
      outcome,
      externalId: p.record.externalId,
      source: p.record.source,
      recordId: target.id,
    };
  }

  private async saveItems(
    m: EntityManager,
    importId: string,
    items: ImportItemResult[],
  ): Promise<void> {
    await m.query(
      `INSERT INTO import_items (import_id, index, external_id, source, outcome, errors, record_id)
       SELECT $1, i, e, s, o, err, r
       FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::jsonb[], $7::uuid[])
         AS u(i, e, s, o, err, r)`,
      [
        importId,
        items.map((i) => i.index),
        items.map((i) => i.externalId),
        items.map((i) => i.source),
        items.map((i) => i.outcome),
        items.map((i) => (i.errors ? JSON.stringify(i.errors) : null)),
        items.map((i) => i.recordId),
      ],
    );
  }
}
