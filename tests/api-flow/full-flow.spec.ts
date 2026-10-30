import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import request from 'supertest';

// Runs against an already running service (docker compose up, or
// npm run start:dev + start:worker:dev). Reads API_KEY / PORT from the shell
// or .env; API_BASE_URL overrides the address.
const fileEnv = existsSync('.env')
  ? parseEnv(readFileSync('.env', 'utf8'))
  : {};
const env = (name: string): string | undefined =>
  process.env[name] ?? fileEnv[name];

const BASE_URL =
  env('API_BASE_URL') ?? `http://localhost:${env('PORT') ?? '3000'}`;
const API_KEY = env('API_KEY') ?? '';

// Unique per run, so the flow never collides with data already stored.
const SOURCE = `api-flow-${Date.now()}`;

const api = () => request(BASE_URL);
const get = (path: string) => api().get(path).set('X-API-Key', API_KEY);
const post = (path: string, body?: object) =>
  api().post(path).set('X-API-Key', API_KEY).send(body);

const rec = (externalId: string, title: string, date = '2026-07-01') => ({
  externalId,
  source: SOURCE,
  title,
  description: 'Open to everyone',
  date,
});

async function waitUntilDone(importId: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const res = await get(`/imports/${importId}`);
    if (res.body.status === 'completed') return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`import ${importId} not completed in 90 s (worker running?)`);
}

jest.setTimeout(120_000);

describe(`Whole flow over HTTP against ${BASE_URL}`, () => {
  let importId: string;
  let items: { index: number; outcome: string; recordId: string | null }[];

  beforeAll(async () => {
    const health = await api().get('/health');
    if (health.status !== 200) {
      throw new Error(`Service not reachable at ${BASE_URL}: start it first`);
    }
  });

  it('1. refuses requests without the API key', async () => {
    expect((await api().get('/records')).status).toBe(401);
  });

  it('2. imports a batch: created / invalid / duplicate / conflict per record', async () => {
    const res = await post('/imports', {
      records: [
        rec('a', 'Football tournament'),
        rec('b', 'Community picnic'),
        rec('c', 'Modern art exhibition'),
        rec('d', ''), // invalid: no title
        rec('a', 'Football tournament'), // duplicate of index 0
        rec('c', 'Changed title'), // conflict with index 2
      ],
    });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      total: 6,
      created: 3,
      invalid: 1,
      duplicate: 1,
      conflict: 1,
    });
    importId = res.body.importId;
    items = res.body.items;
    expect(items[3]).toMatchObject({ outcome: 'invalid', recordId: null });
    expect(items[4].recordId).toBe(items[0].recordId);
  });

  it('3. the worker classifies the records; progress is visible', async () => {
    await waitUntilDone(importId);
    const res = await get(`/imports/${importId}`);
    const c = res.body.classification;
    expect(res.body.status).toBe('completed');
    expect(c.pending + c.processing).toBe(0);
    expect(c.classified + c.needsReview + c.failed).toBe(3);
  });

  it('4. per-record feedback can be filtered', async () => {
    const res = await get(`/imports/${importId}/items?outcome=invalid`);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].errors[0].field).toBe('title');
  });

  it('5. stored records can be searched', async () => {
    const res = await get(`/records?source=${SOURCE}`);
    expect(res.body.total).toBe(3);
    const football = await get(`/records?source=${SOURCE}&q=football`);
    expect(
      football.body.items.map((r: { externalId: string }) => r.externalId),
    ).toEqual(['a']);
  });

  it('6. a re-import creates nothing new and never overwrites', async () => {
    const res = await post('/imports', {
      records: [rec('a', 'Football tournament'), rec('b', 'New title')],
    });
    expect(res.body).toMatchObject({ created: 0, duplicate: 1, conflict: 1 });
    const b = await get(`/records/${items[1].recordId}`);
    expect(b.body.title).toBe('Community picnic');
  });

  it('7. a result needing review is in the queue and can be corrected; the original is kept', async () => {
    // "Community picnic" matches no keyword → other, needs review
    // (unless the flaky mock made it fail every attempt).
    const id = items[1].recordId!;
    const before = await get(`/records/${id}`);
    if (before.body.status === 'failed') {
      await post(`/records/${id}/retry`);
      await waitUntilDone(importId);
    }

    const queue = await get(`/reviews?source=${SOURCE}`);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(id);

    const fixed = await post(`/records/${id}/corrections`, {
      category: 'culture',
      reason: 'A community event',
    });
    expect(fixed.status).toBe(201);
    expect(fixed.body).toMatchObject({
      status: 'classified',
      classification: { category: 'culture', kind: 'correction' },
    });
    expect(fixed.body.history[0]).toMatchObject({
      kind: 'auto',
      category: 'other',
      needsReview: true,
    });

    const after = await get(`/reviews?source=${SOURCE}`);
    expect(after.body.items.map((r: { id: string }) => r.id)).not.toContain(id);
  });

  it('8. retry: only failed records are requeued; nothing else is redone', async () => {
    const res = await post(`/imports/${importId}/retry`);
    expect(res.status).toBe(202);
    await waitUntilDone(importId);

    // Every record ends up finished, each with exactly one automatic result
    // (corrections are extra), and a finished record can't be retried.
    for (const id of [items[0].recordId, items[2].recordId]) {
      const r = await get(`/records/${id}`);
      expect(['classified', 'needs_review']).toContain(r.body.status);
      const autos = r.body.history.filter(
        (h: { kind: string }) => h.kind === 'auto',
      );
      expect(autos).toHaveLength(1);
      expect((await post(`/records/${id}/retry`)).status).toBe(409);
    }
  });
});
