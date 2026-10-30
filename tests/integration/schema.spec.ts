import { DataSource, QueryRunner } from 'typeorm';
import { CATEGORIES } from '../../src/classification/categories';
import { freshMigratedDataSource } from '../helpers/test-db';

// Each test runs in a transaction that is rolled back, so no rows are left.
describe('Database schema (migrations on the real test DB)', () => {
  let ds: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    ds = await freshMigratedDataSource();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    qr = ds.createQueryRunner();
    await qr.startTransaction();
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  async function apiKey(hash = 'a'.repeat(64)): Promise<string> {
    const [row] = await qr.query(
      `INSERT INTO api_keys (name, key_hash) VALUES ('tester', $1) RETURNING id`,
      [hash],
    );
    return row.id;
  }

  async function importRow(keyId: string): Promise<string> {
    const [row] = await qr.query(
      `INSERT INTO imports (api_key_id, total) VALUES ($1, 1) RETURNING id`,
      [keyId],
    );
    return row.id;
  }

  async function record(
    importId: string,
    over: Partial<Record<'source' | 'external_id' | 'title', string>> = {},
  ): Promise<string> {
    const r = {
      source: 'src-a',
      external_id: 'ext-1',
      title: 'Title',
      ...over,
    };
    const [row] = await qr.query(
      `INSERT INTO records (source, external_id, title, description, effective_date, content_hash, import_id)
       VALUES ($1, $2, $3, 'Desc', '2026-01-01', $4, $5) RETURNING id`,
      [r.source, r.external_id, r.title, 'h'.repeat(64), importId],
    );
    return row.id;
  }

  async function autoClassification(recordId: string): Promise<string> {
    const [row] = await qr.query(
      `INSERT INTO classifications (record_id, category, confidence, needs_review, kind)
       VALUES ($1, $2, 0.9, false, 'auto') RETURNING id`,
      [recordId, CATEGORIES[0]],
    );
    return row.id;
  }

  async function setup(): Promise<{
    keyId: string;
    importId: string;
    recordId: string;
  }> {
    const keyId = await apiKey();
    const importId = await importRow(keyId);
    const recordId = await record(importId);
    return { keyId, importId, recordId };
  }

  describe('tables', () => {
    it('creates api_keys, imports, import_items, records, classifications', async () => {
      const rows: { table_name: string }[] = await qr.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const names = rows.map((r) => r.table_name);
      expect(names).toEqual(
        expect.arrayContaining([
          'api_keys',
          'imports',
          'import_items',
          'records',
          'classifications',
        ]),
      );
    });

    it('entities match the migrated schema (no pending changes)', async () => {
      const sql = await ds.driver.createSchemaBuilder().log();
      expect(sql.upQueries.map((q) => q.query)).toEqual([]);
    });
  });

  describe('records', () => {
    it('new record defaults to pending, 0 attempts, no classification', async () => {
      const { recordId } = await setup();
      const [r] = await qr.query(
        `SELECT class_status, attempts, current_classification_id, next_attempt_at FROM records WHERE id = $1`,
        [recordId],
      );
      expect(r.class_status).toBe('pending');
      expect(r.attempts).toBe(0);
      expect(r.current_classification_id).toBeNull();
      expect(r.next_attempt_at).not.toBeNull();
    });

    it('refuses the same source + external_id twice', async () => {
      const { importId } = await setup();
      await expect(record(importId)).rejects.toMatchObject({ code: '23505' });
    });

    it('allows the same external_id from a different source', async () => {
      const { importId } = await setup();
      await expect(
        record(importId, { source: 'src-b' }),
      ).resolves.toBeDefined();
    });

    it('refuses an unknown class_status', async () => {
      const { recordId } = await setup();
      await expect(
        qr.query(`UPDATE records SET class_status = 'done' WHERE id = $1`, [
          recordId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a title over 200 chars', async () => {
      const keyId = await apiKey();
      const importId = await importRow(keyId);
      await expect(
        record(importId, { title: 'x'.repeat(201) }),
      ).rejects.toMatchObject({
        code: '22001',
      });
    });

    it('refuses negative attempts', async () => {
      const { recordId } = await setup();
      await expect(
        qr.query(`UPDATE records SET attempts = -1 WHERE id = $1`, [recordId]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a record pointing to a missing import', async () => {
      await expect(
        record('00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  describe('classifications', () => {
    it('stores an auto classification and links it as current', async () => {
      const { recordId } = await setup();
      const classId = await autoClassification(recordId);
      await qr.query(
        `UPDATE records SET current_classification_id = $1 WHERE id = $2`,
        [classId, recordId],
      );
      const [r] = await qr.query(
        `SELECT current_classification_id FROM records WHERE id = $1`,
        [recordId],
      );
      expect(r.current_classification_id).toBe(classId);
    });

    it('refuses UPDATE (append-only)', async () => {
      const { recordId } = await setup();
      const classId = await autoClassification(recordId);
      await expect(
        qr.query(
          `UPDATE classifications SET category = 'other' WHERE id = $1`,
          [classId],
        ),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses DELETE (append-only)', async () => {
      const { recordId } = await setup();
      const classId = await autoClassification(recordId);
      await expect(
        qr.query(`DELETE FROM classifications WHERE id = $1`, [classId]),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses a category outside the list', async () => {
      const { recordId } = await setup();
      await expect(
        qr.query(
          `INSERT INTO classifications (record_id, category, confidence, needs_review, kind)
           VALUES ($1, 'music', 0.9, false, 'auto')`,
          [recordId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it.each([-0.1, 1.1])('refuses confidence %s', async (confidence) => {
      const { recordId } = await setup();
      await expect(
        qr.query(
          `INSERT INTO classifications (record_id, category, confidence, needs_review, kind)
           VALUES ($1, 'other', $2, false, 'auto')`,
          [recordId, confidence],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses an auto classification without confidence', async () => {
      const { recordId } = await setup();
      await expect(
        qr.query(
          `INSERT INTO classifications (record_id, category, needs_review, kind)
           VALUES ($1, 'other', false, 'auto')`,
          [recordId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('stores a correction linked to the original, which stays unchanged', async () => {
      const { keyId, recordId } = await setup();
      const originalId = await autoClassification(recordId);
      await qr.query(
        `INSERT INTO classifications (record_id, category, needs_review, kind, corrects_id, reason, api_key_id)
         VALUES ($1, 'health', false, 'correction', $2, 'wrong topic', $3)`,
        [recordId, originalId, keyId],
      );
      const [orig] = await qr.query(
        `SELECT category, kind FROM classifications WHERE id = $1`,
        [originalId],
      );
      expect(orig).toEqual({ category: CATEGORIES[0], kind: 'auto' });
    });

    it.each(['corrects_id', 'reason', 'api_key_id'])(
      'refuses a correction without %s',
      async (missing) => {
        const { keyId, recordId } = await setup();
        const originalId = await autoClassification(recordId);
        const values: { [col: string]: string | null } = {
          corrects_id: originalId,
          reason: 'wrong topic',
          api_key_id: keyId,
        };
        values[missing] = null;
        await expect(
          qr.query(
            `INSERT INTO classifications (record_id, category, needs_review, kind, corrects_id, reason, api_key_id)
             VALUES ($1, 'health', false, 'correction', $2::uuid, $3::text, $4::uuid)`,
            [recordId, values.corrects_id, values.reason, values.api_key_id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      },
    );
  });

  describe('import_items', () => {
    it('refuses the same index twice in one import', async () => {
      const { importId, recordId } = await setup();
      const insert = () =>
        qr.query(
          `INSERT INTO import_items (import_id, index, outcome, record_id) VALUES ($1, 0, 'created', $2)`,
          [importId, recordId],
        );
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses an unknown outcome', async () => {
      const { importId } = await setup();
      await expect(
        qr.query(
          `INSERT INTO import_items (import_id, index, outcome) VALUES ($1, 0, 'skipped')`,
          [importId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a created item without a record', async () => {
      const { importId } = await setup();
      await expect(
        qr.query(
          `INSERT INTO import_items (import_id, index, outcome) VALUES ($1, 0, 'created')`,
          [importId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('stores an invalid item with errors and no record', async () => {
      const { importId } = await setup();
      await qr.query(
        `INSERT INTO import_items (import_id, index, outcome, errors) VALUES ($1, 0, 'invalid', $2)`,
        [importId, JSON.stringify([{ field: 'title', message: 'required' }])],
      );
      const [item] = await qr.query(
        `SELECT errors FROM import_items WHERE import_id = $1`,
        [importId],
      );
      expect(item.errors).toEqual([{ field: 'title', message: 'required' }]);
    });
  });

  describe('imports and api_keys', () => {
    it('new import defaults to processing with zero counts', async () => {
      const keyId = await apiKey();
      const importId = await importRow(keyId);
      const [i] = await qr.query(
        `SELECT status, created_count, duplicate_count, conflict_count, invalid_count FROM imports WHERE id = $1`,
        [importId],
      );
      expect(i).toEqual({
        status: 'processing',
        created_count: 0,
        duplicate_count: 0,
        conflict_count: 0,
        invalid_count: 0,
      });
    });

    it('refuses the same key hash twice', async () => {
      await apiKey('b'.repeat(64));
      await expect(apiKey('b'.repeat(64))).rejects.toMatchObject({
        code: '23505',
      });
    });
  });
});

describe('Migrations up / down', () => {
  it('reverts every migration cleanly and runs them again', async () => {
    const ds = await freshMigratedDataSource();
    try {
      while (
        (await ds.query(`SELECT count(*)::int AS n FROM migrations`))[0].n > 0
      ) {
        await ds.undoLastMigration();
      }
      const left: unknown[] = await ds.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name <> 'migrations'`,
      );
      expect(left).toEqual([]);

      await ds.runMigrations();
      expect(await ds.showMigrations()).toBe(false);
    } finally {
      await ds.destroy();
    }
  });
});
