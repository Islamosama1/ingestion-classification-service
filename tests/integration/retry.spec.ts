import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Classifier } from '../../src/classification/classifier';
import { ClassificationWorker } from '../../src/worker/classification-worker';
import { clearData, createTestApp } from '../helpers/test-app';
import { TEST_API_KEY, freshMigratedDataSource } from '../helpers/test-db';

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

describe('Retrying failed records (full app, real test DB)', () => {
  let ds: DataSource;
  let app: INestApplication;
  let importA: string;
  let importB: string;
  let seq = 0;

  const post = (path: string) =>
    request(app.getHttpServer()).post(path).set('X-API-Key', TEST_API_KEY);
  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('X-API-Key', TEST_API_KEY);

  async function newImport(): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO imports (total) VALUES (1) RETURNING id`,
    );
    return id;
  }

  // A record in the given state; failed ones look like the worker left them.
  async function addRecord(
    status: string,
    importId = importA,
  ): Promise<string> {
    seq++;
    const failed = status === 'failed';
    const [{ id }] = await ds.query(
      `INSERT INTO records (source, external_id, title, description, effective_date,
         content_hash, import_id, class_status, attempts, last_error, next_attempt_at)
       VALUES ('partner-a', $1, 'Football tournament', 'Desc', '2026-07-01', $2, $3,
               $4, $5, $6, now() + interval '1 hour')
       RETURNING id`,
      [
        `ext-${seq}`,
        'h'.repeat(64),
        importId,
        status,
        failed ? 5 : 1,
        failed ? 'service down (simulated failure)' : null,
      ],
    );
    if (status === 'classified' || status === 'needs_review') {
      const [{ id: cid }] = await ds.query(
        `INSERT INTO classifications (record_id, category, confidence, needs_review, kind)
         VALUES ($1, 'sports', 0.9, $2, 'auto') RETURNING id`,
        [id, status === 'needs_review'],
      );
      await ds.query(
        `UPDATE records SET current_classification_id = $1 WHERE id = $2`,
        [cid, id],
      );
    }
    return id;
  }

  const row = async (id: string) =>
    (await ds.query(`SELECT * FROM records WHERE id = $1`, [id]))[0];

  const count = async (table: string) =>
    (await ds.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

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

  describe('POST /records/:id/retry', () => {
    it('no API key → 401, nothing changed', async () => {
      const id = await addRecord('failed');
      const res = await request(app.getHttpServer()).post(
        `/records/${id}/retry`,
      );
      expect(res.status).toBe(401);
      expect((await row(id)).class_status).toBe('failed');
    });

    it('failed → 202, back to pending with fresh attempts, due now', async () => {
      const id = await addRecord('failed');
      const res = await post(`/records/${id}/retry`);

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ id, status: 'pending', attempts: 0 });
      const r = await row(id);
      expect(r).toMatchObject({
        class_status: 'pending',
        attempts: 0,
        locked_at: null,
      });
      expect(new Date(r.next_attempt_at).getTime()).toBeLessThanOrEqual(
        Date.now() + 1000,
      );
    });

    it('keeps the last error visible until the next attempt', async () => {
      const id = await addRecord('failed');
      const res = await post(`/records/${id}/retry`);
      expect(res.body.lastError).toBe('service down (simulated failure)');
    });

    it('response matches GET /records/:id', async () => {
      const id = await addRecord('failed');
      const res = await post(`/records/${id}/retry`);
      expect(res.body).toEqual((await get(`/records/${id}`)).body);
    });

    it('no new record or classification is created', async () => {
      const id = await addRecord('failed');
      await post(`/records/${id}/retry`);
      expect(await count('records')).toBe(1);
      expect(await count('classifications')).toBe(0);
    });

    it('the worker then classifies it', async () => {
      const id = await addRecord('failed');
      await post(`/records/${id}/retry`);
      const classifier: Classifier = {
        classify: async () => ({
          category: 'sports',
          confidence: 1,
          needsReview: false,
        }),
      };
      await new ClassificationWorker(ds, classifier, {
        batchSize: 10,
        pollIntervalMs: 50,
        maxAttempts: 5,
        retryBaseMs: 1000,
        retryMaxMs: 60000,
        staleLockMs: 30000,
      }).runOnce();

      expect(await row(id)).toMatchObject({
        class_status: 'classified',
        attempts: 1,
        last_error: null,
      });
    });

    it.each(['pending', 'processing', 'classified', 'needs_review'])(
      '%s record → 409 conflict, nothing changed',
      async (status) => {
        const id = await addRecord(status);
        const before = await row(id);
        const res = await post(`/records/${id}/retry`);

        expect(res.status).toBe(409);
        expect(res.body.error).toEqual({
          code: 'conflict',
          message: expect.stringMatching(/only failed records/i),
        });
        expect(await row(id)).toEqual(before);
      },
    );

    it('retry twice → the second is 409 (not queued twice)', async () => {
      const id = await addRecord('failed');
      expect((await post(`/records/${id}/retry`)).status).toBe(202);
      expect((await post(`/records/${id}/retry`)).status).toBe(409);
    });

    it.each([
      ['unknown id', MISSING_ID],
      ['not a uuid', 'abc'],
    ])('%s → 404', async (_name, id) => {
      const res = await post(`/records/${id}/retry`);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Record not found');
    });
  });

  describe('POST /imports/:id/retry', () => {
    it('no API key → 401', async () => {
      await addRecord('failed');
      const res = await request(app.getHttpServer()).post(
        `/imports/${importA}/retry`,
      );
      expect(res.status).toBe(401);
    });

    it('requeues only the failed records of that import, says how many', async () => {
      const f1 = await addRecord('failed');
      const f2 = await addRecord('failed');
      const ok = await addRecord('classified');
      const review = await addRecord('needs_review');
      const pending = await addRecord('pending');
      const otherImport = await addRecord('failed', importB);
      const before = {
        ok: await row(ok),
        review: await row(review),
        pending: await row(pending),
        otherImport: await row(otherImport),
      };

      const res = await post(`/imports/${importA}/retry`);

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ importId: importA, requeued: 2 });
      for (const id of [f1, f2]) {
        expect(await row(id)).toMatchObject({
          class_status: 'pending',
          attempts: 0,
        });
      }
      // Successful / other work untouched.
      expect(await row(ok)).toEqual(before.ok);
      expect(await row(review)).toEqual(before.review);
      expect(await row(pending)).toEqual(before.pending);
      expect(await row(otherImport)).toEqual(before.otherImport);
      expect(await count('classifications')).toBe(2);
      expect(await count('records')).toBe(6);
    });

    it('the import shows processing again', async () => {
      await addRecord('failed');
      expect((await get(`/imports/${importA}`)).body.status).toBe('completed');
      await post(`/imports/${importA}/retry`);
      expect((await get(`/imports/${importA}`)).body.status).toBe('processing');
    });

    it('nothing failed → 202 with requeued 0', async () => {
      await addRecord('classified');
      const res = await post(`/imports/${importA}/retry`);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ importId: importA, requeued: 0 });
    });

    it('calling twice → second requeues 0', async () => {
      await addRecord('failed');
      await addRecord('failed');
      expect((await post(`/imports/${importA}/retry`)).body.requeued).toBe(2);
      expect((await post(`/imports/${importA}/retry`)).body.requeued).toBe(0);
    });

    it('two calls at the same time → each failed record requeued once in total', async () => {
      for (let i = 0; i < 10; i++) await addRecord('failed');
      const [a, b] = await Promise.all([
        post(`/imports/${importA}/retry`),
        post(`/imports/${importA}/retry`),
      ]);
      expect(a.body.requeued + b.body.requeued).toBe(10);
    });

    it.each([
      ['unknown id', MISSING_ID],
      ['not a uuid', 'abc'],
    ])('%s → 404', async (_name, id) => {
      const res = await post(`/imports/${id}/retry`);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Import not found');
    });
  });
});
