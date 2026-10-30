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

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

describe('Import status and items (full app, real test DB)', () => {
  let ds: DataSource;
  let app: INestApplication;

  const api = () => request(app.getHttpServer());
  const get = (path: string) => api().get(path).set('X-API-Key', TEST_API_KEY);
  const importRecords = async (records: unknown[]) =>
    (
      await api()
        .post('/imports')
        .set('X-API-Key', TEST_API_KEY)
        .send({ records })
    ).body;

  const setStatus = (ids: string[], status: string) =>
    ds.query(`UPDATE records SET class_status = $2 WHERE id = ANY($1)`, [
      ids,
      status,
    ]);

  // 3 created, 1 invalid, 1 duplicate (in batch), 1 conflict (in batch).
  const mixed = () =>
    importRecords([
      rec({ externalId: 'a' }),
      rec({ externalId: 'b' }),
      rec({ externalId: 'c' }),
      rec({ externalId: 'd', title: '' }),
      rec({ externalId: 'a' }),
      rec({ externalId: 'b', title: 'Changed' }),
    ]);

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

  describe('GET /imports/:id', () => {
    it('no API key → 401', async () => {
      const imp = await mixed();
      expect((await api().get(`/imports/${imp.importId}`)).status).toBe(401);
    });

    it.each([
      ['unknown id', MISSING_ID],
      ['not a uuid', 'abc'],
    ])('%s → 404 not_found', async (_name, id) => {
      const res = await get(`/imports/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'not_found', message: 'Import not found' },
      });
    });

    it('right after import: counts as created, all new records pending', async () => {
      const imp = await mixed();
      const res = await get(`/imports/${imp.importId}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        importId: imp.importId,
        status: 'processing',
        createdAt: expect.any(String),
        total: 6,
        created: 3,
        duplicate: 1,
        conflict: 1,
        invalid: 1,
        classification: {
          pending: 3,
          processing: 0,
          classified: 0,
          needsReview: 0,
          failed: 0,
        },
      });
      expect(new Date(res.body.createdAt).toString()).not.toBe('Invalid Date');
    });

    it('progress follows the records as they are classified', async () => {
      const imp = await mixed();
      const ids = imp.items
        .filter((i: { outcome: string }) => i.outcome === 'created')
        .map((i: { recordId: string }) => i.recordId);

      await setStatus([ids[0]], 'processing');
      await setStatus([ids[1]], 'classified');
      let res = await get(`/imports/${imp.importId}`);
      expect(res.body.classification).toEqual({
        pending: 1,
        processing: 1,
        classified: 1,
        needsReview: 0,
        failed: 0,
      });
      expect(res.body.status).toBe('processing');

      await setStatus([ids[0]], 'needs_review');
      await setStatus([ids[2]], 'failed');
      res = await get(`/imports/${imp.importId}`);
      expect(res.body.classification).toEqual({
        pending: 0,
        processing: 0,
        classified: 1,
        needsReview: 1,
        failed: 1,
      });
    });

    it('nothing pending or processing → completed (failed counts as finished)', async () => {
      const imp = await mixed();
      const ids = imp.items
        .filter((i: { outcome: string }) => i.outcome === 'created')
        .map((i: { recordId: string }) => i.recordId);
      await setStatus(ids, 'failed');

      const res = await get(`/imports/${imp.importId}`);
      expect(res.body.status).toBe('completed');
    });

    it('a failed record retried later (back to pending) → processing again', async () => {
      const imp = await mixed();
      const ids = imp.items
        .filter((i: { outcome: string }) => i.outcome === 'created')
        .map((i: { recordId: string }) => i.recordId);
      await setStatus(ids, 'classified');
      expect((await get(`/imports/${imp.importId}`)).body.status).toBe(
        'completed',
      );

      await setStatus([ids[0]], 'pending');
      expect((await get(`/imports/${imp.importId}`)).body.status).toBe(
        'processing',
      );
    });

    it('nothing created → completed, all classification counts 0', async () => {
      const imp = await importRecords([rec({ title: '' })]);
      const res = await get(`/imports/${imp.importId}`);
      expect(res.body.status).toBe('completed');
      expect(res.body.classification).toEqual({
        pending: 0,
        processing: 0,
        classified: 0,
        needsReview: 0,
        failed: 0,
      });
    });

    it('counts only records this import created, not duplicates of older ones', async () => {
      const first = await importRecords([rec()]);
      const second = await importRecords([rec(), rec({ externalId: 'new' })]);
      await setStatus([first.items[0].recordId], 'classified');

      const res = await get(`/imports/${second.importId}`);
      expect(res.body).toMatchObject({ created: 1, duplicate: 1 });
      expect(res.body.classification).toMatchObject({
        pending: 1,
        classified: 0,
      });
    });
  });

  describe('GET /imports/:id/items', () => {
    it('all items in index order, with paging info', async () => {
      const imp = await mixed();
      const res = await get(`/imports/${imp.importId}/items`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 6, limit: 100, offset: 0 });
      expect(res.body.items.map((i: { index: number }) => i.index)).toEqual([
        0, 1, 2, 3, 4, 5,
      ]);
      expect(res.body.items).toEqual(imp.items);
    });

    it('outcome=invalid → only invalid items, with their errors', async () => {
      const imp = await mixed();
      const res = await get(`/imports/${imp.importId}/items?outcome=invalid`);

      expect(res.body.total).toBe(1);
      expect(res.body.items).toEqual([
        {
          index: 3,
          outcome: 'invalid',
          externalId: 'd',
          source: 'partner-a',
          recordId: null,
          errors: [{ field: 'title', message: 'title is required' }],
        },
      ]);
    });

    it.each([
      ['created', 3],
      ['duplicate', 1],
      ['conflict', 1],
    ])('outcome=%s → %i item(s)', async (outcome, n) => {
      const imp = await mixed();
      const res = await get(
        `/imports/${imp.importId}/items?outcome=${outcome}`,
      );
      expect(res.body.total).toBe(n);
      expect(
        res.body.items.every((i: { outcome: string }) => i.outcome === outcome),
      ).toBe(true);
    });

    it('limit + offset page through the items', async () => {
      const imp = await mixed();
      const page1 = await get(`/imports/${imp.importId}/items?limit=4`);
      const page2 = await get(
        `/imports/${imp.importId}/items?limit=4&offset=4`,
      );

      expect(page1.body.items.map((i: { index: number }) => i.index)).toEqual([
        0, 1, 2, 3,
      ]);
      expect(page2.body.items.map((i: { index: number }) => i.index)).toEqual([
        4, 5,
      ]);
      expect(page2.body).toMatchObject({ total: 6, limit: 4, offset: 4 });
    });

    it('offset past the end → empty page, same total', async () => {
      const imp = await mixed();
      const res = await get(`/imports/${imp.importId}/items?offset=50`);
      expect(res.body).toMatchObject({ items: [], total: 6 });
    });

    it.each(['outcome=skipped', 'limit=0', 'limit=5000', 'offset=-1'])(
      '?%s → 400 invalid_query',
      async (qs) => {
        const imp = await mixed();
        const res = await get(`/imports/${imp.importId}/items?${qs}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('invalid_query');
      },
    );

    it('unknown import → 404', async () => {
      const res = await get(`/imports/${MISSING_ID}/items`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('no API key → 401', async () => {
      const imp = await mixed();
      expect((await api().get(`/imports/${imp.importId}/items`)).status).toBe(
        401,
      );
    });
  });
});
