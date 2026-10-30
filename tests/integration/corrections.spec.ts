import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { clearData, createTestApp } from '../helpers/test-app';
import { TEST_API_KEY, freshMigratedDataSource } from '../helpers/test-db';

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /records/:id/corrections (full app, real test DB)', () => {
  let ds: DataSource;
  let app: INestApplication;
  let importId: string;
  let seq = 0;

  const api = () => request(app.getHttpServer());
  const correct = (id: string, body: unknown) =>
    api()
      .post(`/records/${id}/corrections`)
      .set('X-API-Key', TEST_API_KEY)
      .send(body as object);

  // A record in the given status; classified / needs_review ones get an
  // automatic result as their current classification.
  async function addRecord(
    status = 'needs_review',
  ): Promise<{ id: string; autoId: string | null }> {
    seq++;
    const [{ id }] = await ds.query(
      `INSERT INTO records (source, external_id, title, description, effective_date,
         content_hash, import_id, class_status)
       VALUES ('partner-a', $1, 'Clinic open day', 'Desc', '2026-07-01', $2, $3, $4)
       RETURNING id`,
      [`ext-${seq}`, 'h'.repeat(64), importId, status],
    );
    if (status !== 'needs_review' && status !== 'classified') {
      return { id, autoId: null };
    }
    const [{ id: autoId }] = await ds.query(
      `INSERT INTO classifications (record_id, category, confidence, needs_review, kind)
       VALUES ($1, 'other', 0.3, $2, 'auto') RETURNING id`,
      [id, status === 'needs_review'],
    );
    await ds.query(
      `UPDATE records SET current_classification_id = $1 WHERE id = $2`,
      [autoId, id],
    );
    return { id, autoId };
  }

  const classifications = async () =>
    (await ds.query(`SELECT count(*)::int AS n FROM classifications`))[0].n;

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

  it('no API key → 401, nothing written', async () => {
    const { id } = await addRecord();
    const res = await api()
      .post(`/records/${id}/corrections`)
      .send({ category: 'health', reason: 'r' });
    expect(res.status).toBe(401);
    expect(await classifications()).toBe(1);
  });

  it('needs_review record → 201, correction is current, status classified', async () => {
    const { id, autoId } = await addRecord('needs_review');
    const res = await correct(id, {
      category: 'health',
      reason: 'It is a clinic day',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id,
      status: 'classified',
      classification: {
        category: 'health',
        confidence: null,
        needsReview: false,
        kind: 'correction',
      },
    });
    expect(res.body.history).toEqual([
      expect.objectContaining({ id: autoId, kind: 'auto', category: 'other' }),
      expect.objectContaining({
        id: res.body.classification.id,
        kind: 'correction',
        category: 'health',
        correctsId: autoId,
        reason: 'It is a clinic day',
      }),
    ]);
  });

  it('the original result is kept unchanged', async () => {
    const { id, autoId } = await addRecord();
    await correct(id, { category: 'health', reason: 'r' });

    const [orig] = await ds.query(
      `SELECT category, confidence, needs_review, kind FROM classifications WHERE id = $1`,
      [autoId],
    );
    expect(orig).toEqual({
      category: 'other',
      confidence: '0.300',
      needs_review: true,
      kind: 'auto',
    });
  });

  it('response matches GET /records/:id afterwards', async () => {
    const { id } = await addRecord();
    const res = await correct(id, { category: 'health', reason: 'r' });
    const after = await api()
      .get(`/records/${id}`)
      .set('X-API-Key', TEST_API_KEY);
    expect(res.body).toEqual(after.body);
  });

  it('the record leaves the review queue', async () => {
    const { id } = await addRecord();
    const before = await api().get('/reviews').set('X-API-Key', TEST_API_KEY);
    expect(before.body.total).toBe(1);

    await correct(id, { category: 'health', reason: 'r' });

    const after = await api().get('/reviews').set('X-API-Key', TEST_API_KEY);
    expect(after.body.total).toBe(0);
  });

  it('a classified record (not in review) can be corrected too', async () => {
    const { id, autoId } = await addRecord('classified');
    const res = await correct(id, { category: 'culture', reason: 'r' });
    expect(res.status).toBe(201);
    expect(res.body.history.at(-1)).toMatchObject({ correctsId: autoId });
  });

  it('keeping the same category (confirming the result) is allowed', async () => {
    const { id } = await addRecord();
    const res = await correct(id, {
      category: 'other',
      reason: 'Checked, correct',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'classified',
      classification: { category: 'other', kind: 'correction' },
    });
  });

  it('correcting again → new correction points to the previous one, all kept', async () => {
    const { id, autoId } = await addRecord();
    const first = await correct(id, { category: 'health', reason: 'first' });
    const second = await correct(id, {
      category: 'education',
      reason: 'second',
    });

    expect(second.status).toBe(201);
    expect(second.body.classification.category).toBe('education');
    expect(
      second.body.history.map(
        (h: { kind: string; correctsId: string | null }) => [
          h.kind,
          h.correctsId,
        ],
      ),
    ).toEqual([
      ['auto', null],
      ['correction', autoId],
      ['correction', first.body.classification.id],
    ]);
  });

  it('two corrections at the same time → both kept in one chain, none lost', async () => {
    const { id, autoId } = await addRecord();
    const [a, b] = await Promise.all([
      correct(id, { category: 'health', reason: 'a' }),
      correct(id, { category: 'education', reason: 'b' }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);

    const history = (
      await api().get(`/records/${id}`).set('X-API-Key', TEST_API_KEY)
    ).body.history as { id: string; correctsId: string | null }[];
    expect(history).toHaveLength(3);
    // Each correction corrects a different earlier result: a straight chain.
    const corrected = history.slice(1).map((h) => h.correctsId);
    expect(new Set(corrected).size).toBe(2);
    expect(corrected).toContain(autoId);
  });

  it.each(['pending', 'processing', 'failed'])(
    '%s record (no result yet) → 409 conflict, nothing written',
    async (status) => {
      const { id } = await addRecord(status);
      const res = await correct(id, { category: 'health', reason: 'r' });
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({
        code: 'conflict',
        message: expect.stringMatching(/not been classified/i),
      });
      expect(await classifications()).toBe(0);
    },
  );

  it.each([
    ['unknown id', MISSING_ID],
    ['not a uuid', 'abc'],
  ])('%s → 404 not_found', async (_name, id) => {
    const res = await correct(id, { category: 'health', reason: 'r' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Record not found');
  });

  it.each([
    ['category not in the list', { category: 'music', reason: 'r' }],
    ['category missing', { reason: 'r' }],
    ['reason missing', { category: 'health' }],
    ['reason only spaces', { category: 'health', reason: '  ' }],
  ])('%s → 400 invalid_body, nothing written', async (_name, body) => {
    const { id } = await addRecord();
    const res = await correct(id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_body');
    expect(await classifications()).toBe(1);
    const [r] = await ds.query(
      `SELECT class_status FROM records WHERE id = $1`,
      [id],
    );
    expect(r.class_status).toBe('needs_review');
  });

  it('bad body on an unknown record → 400 (the body is checked first)', async () => {
    const res = await correct(MISSING_ID, { category: 'music' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_body');
  });
});
