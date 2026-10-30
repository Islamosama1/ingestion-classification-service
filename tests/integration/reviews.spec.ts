import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { clearData, createTestApp } from '../helpers/test-app';
import { TEST_API_KEY, freshMigratedDataSource } from '../helpers/test-db';

describe('GET /reviews (full app, real test DB)', () => {
  let ds: DataSource;
  let app: INestApplication;
  let importId: string;
  let seq = 0;

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('X-API-Key', TEST_API_KEY);

  // Record stored at createdSec; classified at classifiedSec (seconds after
  // a fixed start), so "stored" and "waiting since" order can differ.
  async function addRecord(
    over: {
      status?: string;
      source?: string;
      category?: string;
      createdSec?: number;
      classifiedSec?: number;
    } = {},
  ): Promise<string> {
    seq++;
    const [{ id }] = await ds.query(
      `INSERT INTO records (source, external_id, title, description, effective_date,
         content_hash, import_id, class_status, created_at)
       VALUES ($1, $2, 'Title', 'Desc', '2026-07-01', $3, $4, 'pending',
               '2026-01-01'::timestamptz + make_interval(secs => $5))
       RETURNING id`,
      [
        over.source ?? 'partner-a',
        `ext-${seq}`,
        'h'.repeat(64),
        importId,
        over.createdSec ?? seq,
      ],
    );
    const status = over.status ?? 'needs_review';
    if (status === 'needs_review' || status === 'classified') {
      const [{ id: cid }] = await ds.query(
        `INSERT INTO classifications (record_id, category, confidence, needs_review, kind, created_at)
         VALUES ($1, $2, 0.4, $3, 'auto',
                 '2026-01-01'::timestamptz + make_interval(secs => $4))
         RETURNING id`,
        [
          id,
          over.category ?? 'other',
          status === 'needs_review',
          over.classifiedSec ?? 1000 + seq,
        ],
      );
      await ds.query(
        `UPDATE records SET current_classification_id = $1 WHERE id = $2`,
        [cid, id],
      );
    }
    await ds.query(`UPDATE records SET class_status = $1 WHERE id = $2`, [
      status,
      id,
    ]);
    return id;
  }

  const ids = (res: request.Response) =>
    res.body.items.map((r: { id: string }) => r.id);

  beforeAll(async () => {
    ds = await freshMigratedDataSource();
    app = await createTestApp();
  });

  beforeEach(async () => {
    [{ id: importId }] = await ds.query(
      `INSERT INTO imports (total) VALUES (1) RETURNING id`,
    );
  });

  afterEach(async () => {
    await clearData(ds);
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('no API key → 401', async () => {
    expect((await request(app.getHttpServer()).get('/reviews')).status).toBe(
      401,
    );
  });

  it('lists only records that need review', async () => {
    const r = await addRecord({ status: 'needs_review' });
    await addRecord({ status: 'classified' });
    await addRecord({ status: 'pending' });
    await addRecord({ status: 'processing' });
    await addRecord({ status: 'failed' });

    const res = await get('/reviews');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([r]);
    expect(res.body.total).toBe(1);
  });

  it('longest waiting first (by when it was flagged, not when it was stored)', async () => {
    const storedFirstFlaggedLast = await addRecord({
      createdSec: 1,
      classifiedSec: 300,
    });
    const storedLastFlaggedFirst = await addRecord({
      createdSec: 3,
      classifiedSec: 100,
    });
    const middle = await addRecord({ createdSec: 2, classifiedSec: 200 });

    expect(ids(await get('/reviews'))).toEqual([
      storedLastFlaggedFirst,
      middle,
      storedFirstFlaggedLast,
    ]);
  });

  it('items have the same shape as /records items', async () => {
    const id = await addRecord({ category: 'culture' });
    const [fromReviews] = (await get('/reviews')).body.items;
    const [fromRecords] = (await get(`/records?needsReview=true`)).body.items;
    expect(fromReviews).toEqual(fromRecords);
    expect(fromReviews).toMatchObject({
      id,
      status: 'needs_review',
      classification: { category: 'culture', needsReview: true, kind: 'auto' },
    });
  });

  it('a record no longer needing review (corrected → classified) leaves the list', async () => {
    const id = await addRecord();
    await ds.query(
      `UPDATE records SET class_status = 'classified' WHERE id = $1`,
      [id],
    );
    expect((await get('/reviews')).body).toMatchObject({ items: [], total: 0 });
  });

  it('limit + offset page through, total stays the same', async () => {
    const all: string[] = [];
    for (let i = 0; i < 5; i++) all.push(await addRecord());
    const p1 = await get('/reviews?limit=2');
    const p2 = await get('/reviews?limit=2&offset=2');
    const p3 = await get('/reviews?limit=2&offset=4');
    expect([...ids(p1), ...ids(p2), ...ids(p3)]).toEqual(all);
    expect(p3.body).toMatchObject({ total: 5, limit: 2, offset: 4 });
  });

  it('record filters work here too (source, category)', async () => {
    const a = await addRecord({ source: 'partner-a', category: 'sports' });
    await addRecord({ source: 'partner-b', category: 'sports' });
    await addRecord({ source: 'partner-a', category: 'other' });
    expect(ids(await get('/reviews?source=partner-a&category=sports'))).toEqual(
      [a],
    );
  });

  it.each(['status=pending', 'needsReview=false', 'category=music', 'limit=0'])(
    '?%s → 400 invalid_query',
    async (qs) => {
      const res = await get(`/reviews?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_query');
    },
  );

  it('nothing to review → empty list', async () => {
    await addRecord({ status: 'classified' });
    expect((await get('/reviews')).body).toMatchObject({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
  });
});
