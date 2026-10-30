import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUuid } from '../common/errors';
import { ClassStatus } from '../records/record.entity';
import { FieldError, ItemOutcome } from './import-item.entity';
import { ImportStatus } from './import.entity';
import { ImportItemResult } from './imports.service';
import { ItemsQuery } from './items-query';

export interface ClassificationProgress {
  pending: number;
  processing: number;
  classified: number;
  needsReview: number;
  failed: number;
}

export interface ImportStatusResult {
  importId: string;
  status: ImportStatus;
  createdAt: string;
  total: number;
  created: number;
  duplicate: number;
  conflict: number;
  invalid: number;
  classification: ClassificationProgress;
}

export interface ImportItemsPage {
  items: ImportItemResult[];
  total: number;
  limit: number;
  offset: number;
}

const PROGRESS_KEY: { [s in ClassStatus]: keyof ClassificationProgress } = {
  pending: 'pending',
  processing: 'processing',
  classified: 'classified',
  needs_review: 'needsReview',
  failed: 'failed',
};

@Injectable()
export class ImportStatusService {
  constructor(private readonly dataSource: DataSource) {}

  // Status is worked out from the import's records on every read, so it is
  // never stale: processing while any is pending / processing, else completed
  // (failed counts as finished; a retried record makes it processing again).
  async getStatus(importId: string): Promise<ImportStatusResult> {
    const imp = await this.findImport(importId);
    const rows: { class_status: ClassStatus; n: number }[] =
      await this.dataSource.query(
        `SELECT class_status, count(*)::int AS n
         FROM records WHERE import_id = $1 GROUP BY class_status`,
        [importId],
      );

    const classification: ClassificationProgress = {
      pending: 0,
      processing: 0,
      classified: 0,
      needsReview: 0,
      failed: 0,
    };
    for (const r of rows) classification[PROGRESS_KEY[r.class_status]] = r.n;

    const busy = classification.pending + classification.processing > 0;
    return {
      importId: imp.id,
      status: busy ? 'processing' : 'completed',
      createdAt: imp.created_at.toISOString(),
      total: imp.total,
      created: imp.created_count,
      duplicate: imp.duplicate_count,
      conflict: imp.conflict_count,
      invalid: imp.invalid_count,
      classification,
    };
  }

  async listItems(importId: string, q: ItemsQuery): Promise<ImportItemsPage> {
    await this.findImport(importId);
    const params: unknown[] = [importId];
    let where = 'import_id = $1';
    if (q.outcome) {
      params.push(q.outcome);
      where += ' AND outcome = $2';
    }

    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM import_items WHERE ${where}`,
      params,
    );
    const rows: {
      index: number;
      outcome: ItemOutcome;
      external_id: string | null;
      source: string | null;
      record_id: string | null;
      errors: FieldError[] | null;
    }[] = await this.dataSource.query(
      `SELECT index, outcome, external_id, source, record_id, errors
       FROM import_items WHERE ${where}
       ORDER BY index
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, q.offset],
    );

    return {
      items: rows.map((r) => ({
        index: r.index,
        outcome: r.outcome,
        externalId: r.external_id,
        source: r.source,
        recordId: r.record_id,
        // Same shape as the POST /imports response: errors only when invalid.
        ...(r.errors ? { errors: r.errors } : {}),
      })),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  private async findImport(importId: string): Promise<{
    id: string;
    total: number;
    created_count: number;
    duplicate_count: number;
    conflict_count: number;
    invalid_count: number;
    created_at: Date;
  }> {
    const [imp] = isUuid(importId)
      ? await this.dataSource.query(
          `SELECT id, total, created_count, duplicate_count, conflict_count,
                  invalid_count, created_at
           FROM imports WHERE id = $1`,
          [importId],
        )
      : [];
    if (!imp) throw new NotFoundException('Import not found');
    return imp;
  }
}
