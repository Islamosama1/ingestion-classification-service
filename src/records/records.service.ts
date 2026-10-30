import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Category } from '../classification/categories';
import { ClassificationKind } from '../classification/classification.entity';
import { isUuid } from '../common/errors';
import { ClassStatus } from './record.entity';
import { RecordsQuery } from './records-query';

export interface ClassificationView {
  id: string;
  category: Category;
  // null for corrections (a person decided, no score).
  confidence: number | null;
  needsReview: boolean;
  kind: ClassificationKind;
  createdAt: string;
}

export interface HistoryEntry extends ClassificationView {
  correctsId: string | null;
  reason: string | null;
}

export interface RecordView {
  id: string;
  externalId: string;
  source: string;
  title: string;
  description: string;
  date: string;
  importId: string;
  status: ClassStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  classification: ClassificationView | null;
}

export interface RecordsPage {
  items: RecordView[];
  total: number;
  limit: number;
  offset: number;
}

interface RecordRow {
  id: string;
  external_id: string;
  source: string;
  title: string;
  description: string;
  effective_date: Date;
  import_id: string;
  class_status: ClassStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  c_id: string | null;
  c_category: Category | null;
  c_confidence: string | null;
  c_needs_review: boolean | null;
  c_kind: ClassificationKind | null;
  c_created_at: Date | null;
}

const SELECT_RECORD = `
  SELECT r.id, r.external_id, r.source, r.title, r.description, r.effective_date,
         r.import_id, r.class_status, r.attempts, r.last_error, r.created_at,
         c.id AS c_id, c.category AS c_category, c.confidence AS c_confidence,
         c.needs_review AS c_needs_review, c.kind AS c_kind,
         c.created_at AS c_created_at
  FROM records r
  LEFT JOIN classifications c ON c.id = r.current_classification_id`;

// pg returns numeric as a string.
const toNumber = (v: string | null): number | null =>
  v === null ? null : Number(v);

const ORDER = {
  // /records: newest stored first.
  newest: 'r.created_at DESC, r.id DESC',
  // /reviews: longest waiting first (when the current result was saved).
  longestWaiting: 'c.created_at ASC, r.id ASC',
};

export type RecordsOrder = keyof typeof ORDER;

// Text search treats % and _ as plain characters.
const likePattern = (q: string): string =>
  `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

@Injectable()
export class RecordsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    q: RecordsQuery,
    order: RecordsOrder = 'newest',
  ): Promise<RecordsPage> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (q.source !== undefined) add('r.source = ?', q.source);
    if (q.category !== undefined) add('c.category = ?', q.category);
    if (q.status !== undefined) add('r.class_status = ?', q.status);
    if (q.needsReview !== undefined) {
      where.push(
        q.needsReview
          ? `r.class_status = 'needs_review'`
          : `r.class_status <> 'needs_review'`,
      );
    }
    if (q.importId !== undefined) add('r.import_id = ?', q.importId);
    if (q.from !== undefined) add('r.effective_date >= ?', q.from);
    if (q.toBefore !== undefined) add('r.effective_date < ?', q.toBefore);
    if (q.q !== undefined) add(`r.title ILIKE ? ESCAPE '\\'`, likePattern(q.q));

    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM records r
       LEFT JOIN classifications c ON c.id = r.current_classification_id
       ${filter}`,
      params,
    );
    const rows: RecordRow[] = await this.dataSource.query(
      `${SELECT_RECORD} ${filter}
       ORDER BY ${ORDER[order]}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, q.offset],
    );

    return {
      items: rows.map(toView),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }

  // The record, its current classification, and every classification it
  // ever had (auto results and corrections), oldest first.
  async get(id: string): Promise<RecordView & { history: HistoryEntry[] }> {
    const [row]: RecordRow[] = isUuid(id)
      ? await this.dataSource.query(`${SELECT_RECORD} WHERE r.id = $1`, [id])
      : [];
    if (!row) throw new NotFoundException('Record not found');

    const history: {
      id: string;
      category: Category;
      confidence: string | null;
      needs_review: boolean;
      kind: ClassificationKind;
      corrects_id: string | null;
      reason: string | null;
      created_at: Date;
    }[] = await this.dataSource.query(
      `SELECT id, category, confidence, needs_review, kind, corrects_id, reason, created_at
       FROM classifications WHERE record_id = $1
       ORDER BY created_at, id`,
      [id],
    );

    return {
      ...toView(row),
      history: history.map((h) => ({
        id: h.id,
        category: h.category,
        confidence: toNumber(h.confidence),
        needsReview: h.needs_review,
        kind: h.kind,
        correctsId: h.corrects_id,
        reason: h.reason,
        createdAt: h.created_at.toISOString(),
      })),
    };
  }
}

function toView(r: RecordRow): RecordView {
  return {
    id: r.id,
    externalId: r.external_id,
    source: r.source,
    title: r.title,
    description: r.description,
    date: r.effective_date.toISOString(),
    importId: r.import_id,
    status: r.class_status,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    classification: r.c_id
      ? {
          id: r.c_id,
          category: r.c_category!,
          confidence: toNumber(r.c_confidence),
          needsReview: r.c_needs_review!,
          kind: r.c_kind!,
          createdAt: r.c_created_at!.toISOString(),
        }
      : null,
  };
}
