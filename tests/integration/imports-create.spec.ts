import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { clearData, createTestApp } from '../helpers/test-app';
import { TEST_API_KEY, freshMigratedDataSource } from '../helpers/test-db';

const rec = (over: { [k: string]: unknown } = {}) => ({
  externalId: 'ext-1',
  source: 'partner-a',
  title: 'Football camp',
  description: 'Summer camp for kids',
  date: '2026-07-01',
  ...over,
});

const many = (n: number, prefix = 'ext') =>
  Array.from({ length: n }, (_, i) => rec({ externalId: `${prefix}-${i}` }));

describe('POST /imports (full app, real test DB)', () => {
  let ds: DataSource;
  let app: INestApplication;

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/imports')
      .set('X-API-Key', TEST_API_KEY)
      .send(body as object);

  const count = async (table: string): Promise<number> =>
    (await ds.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

  beforeAll(async () => {
    ds = await freshMigratedDataSource();
    app = await createTestApp();
  });

  afterEach(async () => {
    await clearData(ds);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  describe('refused requests (nothing stored)', () => {
    it('no API key → 401 in the shared error shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/imports')
        .send({ records: [rec()] });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'unauthorized', message: expect.any(String) },
      });
      expect(await count('imports')).toBe(0);
    });

    it.each([
      ['records missing', {}],
      ['records not an array', { records: rec() }],
      ['empty records', { records: [] }],
      ['1001 records', { records: many(1001) }],
    ])('%s → 400 invalid_batch', async (_name, body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_batch');
      expect(await count('imports')).toBe(0);
      expect(await count('records')).toBe(0);
    });

    it('malformed JSON → 400 invalid_json', async () => {
      const res = await request(app.getHttpServer())
        .post('/imports')
        .set('X-API-Key', TEST_API_KEY)
        .set('Content-Type', 'application/json')
        .send('{"records": [');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_json');
    });
  });

  describe('new records', () => {
    it('all valid → 202, every item created, rows stored as pending', async () => {
      const res = await post({ records: many(3) });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        importId: expect.any(String),
        status: 'processing',
        total: 3,
        created: 3,
        duplicate: 0,
        conflict: 0,
        invalid: 0,
      });
      expect(res.body.items).toHaveLength(3);
      res.body.items.forEach((item: { [k: string]: unknown }, i: number) => {
        expect(item).toEqual({
          index: i,
          outcome: 'created',
          externalId: `ext-${i}`,
          source: 'partner-a',
          recordId: expect.any(String),
        });
      });

      const rows = await ds.query(
        `SELECT class_status, import_id, title FROM records ORDER BY external_id`,
      );
      expect(rows).toHaveLength(3);
      rows.forEach((r: { [k: string]: unknown }) =>
        expect(r).toMatchObject({
          class_status: 'pending',
          import_id: res.body.importId,
          title: 'Football camp',
        }),
      );
    });

    it('stores trimmed values and the date in UTC', async () => {
      await post({
        records: [
          rec({
            title: '  Football camp  ',
            date: '2026-07-01T12:30:00+02:00',
          }),
        ],
      });
      const [row] = await ds.query(`SELECT title, effective_date FROM records`);
      expect(row.title).toBe('Football camp');
      expect(new Date(row.effective_date).toISOString()).toBe(
        '2026-07-01T10:30:00.000Z',
      );
    });

    it('saves the import and one import_item per submitted record', async () => {
      const res = await post({
        records: [rec(), rec({ externalId: 'e2', title: '' })],
      });
      const [imp] = await ds.query(`SELECT * FROM imports WHERE id = $1`, [
        res.body.importId,
      ]);
      expect(imp).toMatchObject({
        total: 2,
        created_count: 1,
        invalid_count: 1,
        duplicate_count: 0,
        conflict_count: 0,
      });
      const items = await ds.query(
        `SELECT index, outcome FROM import_items WHERE import_id = $1 ORDER BY index`,
        [res.body.importId],
      );
      expect(items).toEqual([
        { index: 0, outcome: 'created' },
        { index: 1, outcome: 'invalid' },
      ]);
    });

    it('accepts the max: 1000 records in one import', async () => {
      const res = await post({ records: many(1000) });
      expect(res.status).toBe(202);
      expect(res.body.created).toBe(1000);
      expect(await count('records')).toBe(1000);
    });
  });

  describe('invalid records', () => {
    it('mixed batch → invalid ones get errors and no record, valid ones are stored', async () => {
      const res = await post({
        records: [rec(), rec({ externalId: 'e2', date: '2026-02-30' }), 'junk'],
      });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ total: 3, created: 1, invalid: 2 });
      expect(res.body.items[1]).toEqual({
        index: 1,
        outcome: 'invalid',
        externalId: 'e2',
        source: 'partner-a',
        recordId: null,
        errors: [{ field: 'date', message: expect.stringMatching(/ISO 8601/) }],
      });
      expect(res.body.items[2]).toMatchObject({
        outcome: 'invalid',
        externalId: null,
        errors: [{ field: 'record', message: expect.any(String) }],
      });
      expect(await count('records')).toBe(1);
    });

    it('stores the field errors on the import_item', async () => {
      const res = await post({ records: [rec({ title: '' })] });
      const [item] = await ds.query(
        `SELECT errors, record_id FROM import_items WHERE import_id = $1`,
        [res.body.importId],
      );
      expect(item).toEqual({
        errors: [{ field: 'title', message: 'title is required' }],
        record_id: null,
      });
    });

    it('nothing to classify (all invalid) → import is completed', async () => {
      const res = await post({ records: [rec({ title: '' })] });
      expect(res.body.status).toBe('completed');
    });
  });

  describe('duplicates and conflicts', () => {
    it('same record twice in one batch → created + duplicate of it', async () => {
      const res = await post({ records: [rec(), rec()] });
      expect(res.body).toMatchObject({ created: 1, duplicate: 1 });
      expect(res.body.items[1]).toMatchObject({
        outcome: 'duplicate',
        recordId: res.body.items[0].recordId,
      });
      expect(await count('records')).toBe(1);
    });

    it('same id, other content in one batch → created + conflict, first one kept', async () => {
      const res = await post({ records: [rec(), rec({ title: 'Changed' })] });
      expect(res.body).toMatchObject({ created: 1, conflict: 1 });
      expect(res.body.items[1]).toMatchObject({
        outcome: 'conflict',
        recordId: res.body.items[0].recordId,
      });
      const [row] = await ds.query(`SELECT title FROM records`);
      expect(row.title).toBe('Football camp');
    });

    it('re-import of an existing record → duplicate, points to it, no new row', async () => {
      const first = await post({ records: [rec()] });
      const second = await post({ records: [rec()] });

      expect(second.body).toMatchObject({
        created: 0,
        duplicate: 1,
        status: 'completed',
      });
      expect(second.body.items[0]).toMatchObject({
        outcome: 'duplicate',
        recordId: first.body.items[0].recordId,
      });
      expect(await count('records')).toBe(1);
    });

    it('existing record, different content → conflict, original not overwritten', async () => {
      await post({ records: [rec()] });
      const res = await post({
        records: [rec({ title: 'New title', description: 'New desc' })],
      });

      expect(res.body.items[0].outcome).toBe('conflict');
      const [row] = await ds.query(
        `SELECT title, description, import_id FROM records`,
      );
      expect(row).toMatchObject({
        title: 'Football camp',
        description: 'Summer camp for kids',
      });
      expect(row.import_id).not.toBe(res.body.importId);
    });

    it('same instant written differently → duplicate, not conflict', async () => {
      await post({ records: [rec({ date: '2026-07-01' })] });
      const res = await post({
        records: [rec({ date: '2026-07-01T02:00:00+02:00' })],
      });
      expect(res.body.items[0].outcome).toBe('duplicate');
    });

    it('same externalId from another source → a separate record', async () => {
      const res = await post({
        records: [rec(), rec({ source: 'partner-b' })],
      });
      expect(res.body.created).toBe(2);
      expect(await count('records')).toBe(2);
    });

    it('re-import does not reset the existing record (status, attempts)', async () => {
      const first = await post({ records: [rec()] });
      const id = first.body.items[0].recordId;
      await ds.query(
        `UPDATE records SET class_status = 'failed', attempts = 3 WHERE id = $1`,
        [id],
      );
      await post({ records: [rec()] });
      const [row] = await ds.query(
        `SELECT class_status, attempts FROM records WHERE id = $1`,
        [id],
      );
      expect(row).toEqual({ class_status: 'failed', attempts: 3 });
    });

    it('two imports at the same time with the same 50 records → 50 rows only', async () => {
      const records = many(50, 'race');
      const [a, b] = await Promise.all([post({ records }), post({ records })]);

      expect(a.status).toBe(202);
      expect(b.status).toBe(202);
      expect(a.body.created + b.body.created).toBe(50);
      expect(a.body.duplicate + b.body.duplicate).toBe(50);
      expect(await count('records')).toBe(50);
    });
  });
});
