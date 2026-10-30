import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { clearData, createTestApp } from '../helpers/test-app';
import { TEST_API_KEY, freshMigratedDataSource } from '../helpers/test-db';

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

describe('GET /records and GET /records/:id (full app, real test DB)', () => {
  let ds: DataSource;
  let app: INestApplication;
  let importA: string;
  let importB: string;
  let seq = 0;

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('X-API-Key', TEST_API_KEY);

  async function newImport(): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO imports (total) VALUES (1) RETURNING id`,
    );
    return id;
  }

  // Inserts a record; created_at increases with each call (stable order).
  async function addRecord(
    over: {
      importId?: string;
      source?: string;
      title?: string;
      date?: string;
      status?: string;
      attempts?: number;
      lastError?: string | null;
    } = {},
  ): Promise<string> {
    seq++;
    const [{ id }] = await ds.query(
      `INSERT INTO records (source, external_id, title, description, effective_date,
         content_hash, import_id, class_status, attempts, last_error, created_at)
       VALUES ($1, $2, $3, 'Desc', $4, $5, $6, $7, $8, $9,
               '2026-01-01'::timestamptz + make_interval(secs => $10))
       RETURNING id`,
      [
        over.source ?? 'partner-a',
        `ext-${seq}`,
        over.title ?? `Record ${seq}`,
        over.date ?? '2026-07-01',
        'h'.repeat(64),
        over.importId ?? importA,
        over.status ?? 'pending',
        over.attempts ?? 0,
        over.lastError ?? null,
        seq,
      ],
    );
    return id;
  }

  async function classify(
    recordId: string,
    category: string,
    needsReview = false,
  ): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO classifications (record_id, category, confidence, needs_review, kind)
       VALUES ($1, $2, 0.875, $3, 'auto') RETURNING id`,
      [recordId, category, needsReview],
    );
    await ds.query(
      `UPDATE records SET current_classification_id = $1,
         class_status = $3 WHERE id = $2`,
      [id, recordId, needsReview ? 'needs_review' : 'classified'],
    );
    return id;
  }

  async function correct(
    recordId: string,
    correctsId: string,
    category: string,
  ): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO classifications (record_id, category, needs_review, kind, corrects_id, reason, created_at)
       VALUES ($1, $2, false, 'correction', $3, 'wrong topic', now() + interval '1 second')
       RETURNING id`,
      [recordId, category, correctsId],
    );
    await ds.query(
      `UPDATE records SET current_classification_id = $1, class_status = 'classified'
       WHERE id = $2`,
      [id, recordId],
    );
    return id;
  }

  const ids = (res: request.Response) =>
    res.body.items.map((r: { id: string }) => r.id);

  beforeAll(async () => {
    ds = await freshMigratedDataSource();
    app = await createTestApp();
  });

  beforeEach(async () => {
    importA = await newImport();
    importB = await newImport();
  });

  afterEach(async () => {
    await clearData(ds);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  describe('GET /records', () => {
    it('no API key → 401', async () => {
      const res = await request(app.getHttpServer()).get('/records');
      expect(res.status).toBe(401);
    });

    it('lists records newest first, with paging info', async () => {
      const r1 = await addRecord();
      const r2 = await addRecord();
      const r3 = await addRecord();
      const res = await get('/records');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 3, limit: 50, offset: 0 });
      expect(ids(res)).toEqual([r3, r2, r1]);
    });

    it('each item has the record, its status and current classification', async () => {
      const id = await addRecord({
        title: 'Football camp',
        date: '2026-07-01T10:30:00Z',
        status: 'pending',
        attempts: 1,
        lastError: 'service down',
      });
      await classify(id, 'sports');
      const [item] = (await get('/records')).body.items;

      expect(item).toEqual({
        id,
        externalId: expect.stringMatching(/^ext-/),
        source: 'partner-a',
        title: 'Football camp',
        description: 'Desc',
        date: '2026-07-01T10:30:00.000Z',
        importId: importA,
        status: 'classified',
        attempts: 1,
        lastError: 'service down',
        createdAt: expect.any(String),
        classification: {
          id: expect.any(String),
          category: 'sports',
          confidence: 0.875,
          needsReview: false,
          kind: 'auto',
          createdAt: expect.any(String),
        },
      });
    });

    it('a record not classified yet has classification null', async () => {
      await addRecord();
      const [item] = (await get('/records')).body.items;
      expect(item.classification).toBeNull();
    });

    it('limit + offset page through, total stays the same', async () => {
      const all: string[] = [];
      for (let i = 0; i < 5; i++) all.unshift(await addRecord());
      const p1 = await get('/records?limit=2');
      const p2 = await get('/records?limit=2&offset=2');
      const p3 = await get('/records?limit=2&offset=4');

      expect([...ids(p1), ...ids(p2), ...ids(p3)]).toEqual(all);
      expect(p3.body).toMatchObject({ total: 5, limit: 2, offset: 4 });
    });

    it('?source= → only that source', async () => {
      const a = await addRecord({ source: 'partner-a' });
      await addRecord({ source: 'partner-b' });
      const res = await get('/records?source=partner-a');
      expect(ids(res)).toEqual([a]);
      expect(res.body.total).toBe(1);
    });

    it('?category= → by current classification', async () => {
      const s = await addRecord();
      const c = await addRecord();
      await addRecord(); // unclassified
      await classify(s, 'sports');
      await classify(c, 'culture');
      expect(ids(await get('/records?category=sports'))).toEqual([s]);
    });

    it('?category= follows a correction (current, not original)', async () => {
      const id = await addRecord();
      const auto = await classify(id, 'sports', true);
      await correct(id, auto, 'health');

      expect(ids(await get('/records?category=health'))).toEqual([id]);
      expect(ids(await get('/records?category=sports'))).toEqual([]);
    });

    it('?status= → only that status', async () => {
      await addRecord({ status: 'pending' });
      const f = await addRecord({ status: 'failed' });
      expect(ids(await get('/records?status=failed'))).toEqual([f]);
    });

    it('?needsReview=true / false', async () => {
      const r = await addRecord();
      const ok = await addRecord();
      await classify(r, 'other', true);
      await classify(ok, 'sports');
      const p = await addRecord({ status: 'pending' });

      expect(ids(await get('/records?needsReview=true'))).toEqual([r]);
      expect(ids(await get('/records?needsReview=false')).sort()).toEqual(
        [ok, p].sort(),
      );
    });

    it('?importId= → only records created by that import', async () => {
      await addRecord({ importId: importA });
      const b = await addRecord({ importId: importB });
      expect(ids(await get(`/records?importId=${importB}`))).toEqual([b]);
    });

    it('?from= / ?to= on the record date, both ends included', async () => {
      await addRecord({ date: '2026-06-30T23:59:59Z' });
      const d1 = await addRecord({ date: '2026-07-01' });
      const d2 = await addRecord({ date: '2026-07-31T18:00:00Z' });
      await addRecord({ date: '2026-08-01' });

      const res = await get('/records?from=2026-07-01&to=2026-07-31');
      expect(ids(res).sort()).toEqual([d1, d2].sort());
    });

    it('?q= → title contains the text, any case', async () => {
      const a = await addRecord({ title: 'Football Camp' });
      const b = await addRecord({ title: 'Summer CAMPING trip' });
      await addRecord({ title: 'Art fair' });
      expect(ids(await get('/records?q=camp')).sort()).toEqual([a, b].sort());
    });

    it('?q= treats % and _ as plain characters', async () => {
      const pct = await addRecord({ title: '100% fun' });
      await addRecord({ title: '100 fun' });
      await addRecord({ title: 'A_B' });
      await addRecord({ title: 'AxB' });
      expect(ids(await get('/records?q=100%25'))).toEqual([pct]);
      expect((await get('/records?q=A_B')).body.total).toBe(1);
    });

    it('filters combine (AND)', async () => {
      const hit = await addRecord({ source: 'partner-a', title: 'Camp' });
      await addRecord({ source: 'partner-b', title: 'Camp' });
      await addRecord({ source: 'partner-a', title: 'Fair' });
      await classify(hit, 'sports');
      expect(
        ids(await get('/records?source=partner-a&q=camp&category=sports')),
      ).toEqual([hit]);
    });

    it('no match → empty list, total 0', async () => {
      await addRecord();
      expect((await get('/records?source=nobody')).body).toMatchObject({
        items: [],
        total: 0,
      });
    });

    it.each([
      'category=music',
      'status=done',
      'needsReview=yes',
      'importId=abc',
      'from=yesterday',
      'from=2026-08-01&to=2026-07-01',
      'limit=500',
    ])('?%s → 400 invalid_query', async (qs) => {
      const res = await get(`/records?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_query');
    });
  });

  describe('GET /records/:id', () => {
    it('no API key → 401', async () => {
      const id = await addRecord();
      expect(
        (await request(app.getHttpServer()).get(`/records/${id}`)).status,
      ).toBe(401);
    });

    it.each([
      ['unknown id', MISSING_ID],
      ['not a uuid', 'abc'],
    ])('%s → 404 not_found', async (_name, id) => {
      const res = await get(`/records/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'not_found', message: 'Record not found' },
      });
    });

    it('record + current classification + full history, oldest first', async () => {
      const id = await addRecord({ title: 'Football camp' });
      const auto = await classify(id, 'sports', true);
      const fix = await correct(id, auto, 'health');

      const res = await get(`/records/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        title: 'Football camp',
        status: 'classified',
        classification: { id: fix, category: 'health', kind: 'correction' },
      });
      expect(res.body.history).toEqual([
        {
          id: auto,
          category: 'sports',
          confidence: 0.875,
          needsReview: true,
          kind: 'auto',
          correctsId: null,
          reason: null,
          createdAt: expect.any(String),
        },
        {
          id: fix,
          category: 'health',
          confidence: null,
          needsReview: false,
          kind: 'correction',
          correctsId: auto,
          reason: 'wrong topic',
          createdAt: expect.any(String),
        },
      ]);
    });

    it('not classified yet → classification null, history empty', async () => {
      const id = await addRecord();
      const res = await get(`/records/${id}`);
      expect(res.body).toMatchObject({ classification: null, history: [] });
    });

    it('same fields as the list item for the record itself', async () => {
      const id = await addRecord();
      await classify(id, 'sports');
      const [listed] = (await get('/records')).body.items;
      const single = { ...(await get(`/records/${id}`)).body };
      delete single.history;
      expect(single).toEqual(listed);
    });
  });
});
