import { DataSource } from 'typeorm';
import {
  Classifier,
  ClassifierInput,
  ClassifierResult,
} from '../../src/classification/classifier';
import { ClassificationFailedError } from '../../src/classification/mock-classifier';
import {
  ClassificationWorker,
  WorkerOptions,
} from '../../src/worker/classification-worker';
import { clearData } from '../helpers/test-app';
import { freshMigratedDataSource } from '../helpers/test-db';

const SPORTS: ClassifierResult = {
  category: 'sports',
  confidence: 0.95,
  needsReview: false,
};

const OPTIONS: WorkerOptions = {
  batchSize: 10,
  maxAttempts: 3,
  retryBaseMs: 60_000,
  retryMaxMs: 600_000,
  staleLockMs: 30_000,
  pollIntervalMs: 50,
};

// Answers from a script; records every call.
class FakeClassifier implements Classifier {
  calls: ClassifierInput[] = [];
  constructor(
    private readonly answer: (
      input: ClassifierInput,
    ) => Promise<ClassifierResult> = async () => SPORTS,
  ) {}
  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    this.calls.push(input);
    return this.answer(input);
  }
}

const failing = () =>
  new FakeClassifier(async () => {
    throw new ClassificationFailedError('service down (simulated failure)');
  });

describe('ClassificationWorker (real test DB)', () => {
  let ds: DataSource;
  let importId: string;
  let seq = 0;

  const worker = (classifier: Classifier, over: Partial<WorkerOptions> = {}) =>
    new ClassificationWorker(ds, classifier, { ...OPTIONS, ...over });

  async function addRecord(
    over: { [col: string]: unknown } = {},
  ): Promise<string> {
    const r = {
      external_id: `ext-${++seq}`,
      title: 'Football tournament',
      description: 'Kids',
      class_status: 'pending',
      attempts: 0,
      next_attempt_at: new Date(Date.now() - 1000),
      locked_at: null,
      ...over,
    };
    const [row] = await ds.query(
      `INSERT INTO records (source, external_id, title, description, effective_date,
         content_hash, import_id, class_status, attempts, next_attempt_at, locked_at)
       VALUES ('src', $1, $2, $3, '2026-07-01', $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        r.external_id,
        r.title,
        r.description,
        'h'.repeat(64),
        importId,
        r.class_status,
        r.attempts,
        r.next_attempt_at,
        r.locked_at,
      ],
    );
    return row.id;
  }

  const record = async (id: string) =>
    (await ds.query(`SELECT * FROM records WHERE id = $1`, [id]))[0];

  const classificationsOf = (id: string) =>
    ds.query(`SELECT * FROM classifications WHERE record_id = $1`, [id]);

  beforeAll(async () => {
    ds = await freshMigratedDataSource();
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
    await ds.destroy();
  });

  describe('success', () => {
    it('pending → classified, result saved and linked as current', async () => {
      const id = await addRecord();
      const n = await worker(new FakeClassifier()).runOnce();

      expect(n).toBe(1);
      const r = await record(id);
      expect(r).toMatchObject({
        class_status: 'classified',
        attempts: 1,
        locked_at: null,
        last_error: null,
      });
      const [c] = await classificationsOf(id);
      expect(c).toMatchObject({
        category: 'sports',
        confidence: '0.950',
        needs_review: false,
        kind: 'auto',
      });
      expect(r.current_classification_id).toBe(c.id);
    });

    it('result needing review → needs_review', async () => {
      const id = await addRecord();
      await worker(
        new FakeClassifier(async () => ({
          category: 'other',
          confidence: 0,
          needsReview: true,
        })),
      ).runOnce();

      expect((await record(id)).class_status).toBe('needs_review');
      const [c] = await classificationsOf(id);
      expect(c).toMatchObject({ category: 'other', needs_review: true });
    });

    it('sends title and description to the classifier', async () => {
      await addRecord({ title: 'Art fair', description: 'In the museum' });
      const classifier = new FakeClassifier();
      await worker(classifier).runOnce();
      expect(classifier.calls).toEqual([
        { title: 'Art fair', description: 'In the museum' },
      ]);
    });

    it('nothing due → runOnce returns 0, classifier not called', async () => {
      const classifier = new FakeClassifier();
      expect(await worker(classifier).runOnce()).toBe(0);
      expect(classifier.calls).toEqual([]);
    });

    it('takes at most batchSize records per run, oldest due first', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(
          await addRecord({
            next_attempt_at: new Date(Date.now() - 10_000 + i),
          }),
        );
      }
      expect(
        await worker(new FakeClassifier(), { batchSize: 2 }).runOnce(),
      ).toBe(2);

      const done = await ds.query(
        `SELECT id FROM records WHERE class_status = 'classified'`,
      );
      expect(done.map((r: { id: string }) => r.id).sort()).toEqual(
        ids.slice(0, 2).sort(),
      );
    });

    it('once all of an import is done, the import shows completed', async () => {
      await addRecord();
      await addRecord();
      await worker(new FakeClassifier()).runOnce();
      const busy = await ds.query(
        `SELECT count(*)::int AS n FROM records
         WHERE import_id = $1 AND class_status IN ('pending', 'processing')`,
        [importId],
      );
      expect(busy[0].n).toBe(0);
    });
  });

  describe('never repeats finished work', () => {
    it.each(['classified', 'needs_review', 'failed'])(
      '%s records are not picked up',
      async (status) => {
        await addRecord({ class_status: status });
        const classifier = new FakeClassifier();
        expect(await worker(classifier).runOnce()).toBe(0);
        expect(classifier.calls).toEqual([]);
      },
    );

    it('a pending record not yet due (waiting to retry) is not picked up', async () => {
      await addRecord({ next_attempt_at: new Date(Date.now() + 60_000) });
      expect(await worker(new FakeClassifier()).runOnce()).toBe(0);
    });
  });

  describe('failures and retries', () => {
    it('failure → back to pending, attempt counted, error kept, retry later', async () => {
      const id = await addRecord();
      const before = Date.now();
      await worker(failing()).runOnce();

      const r = await record(id);
      expect(r).toMatchObject({
        class_status: 'pending',
        attempts: 1,
        locked_at: null,
        last_error: 'service down (simulated failure)',
      });
      // retryBaseMs = 60 s after the 1st attempt
      const wait = new Date(r.next_attempt_at).getTime() - before;
      expect(wait).toBeGreaterThanOrEqual(59_000);
      expect(wait).toBeLessThan(65_000);
      expect(await classificationsOf(id)).toEqual([]);
    });

    it('not retried before its time', async () => {
      await addRecord();
      const w = worker(failing());
      await w.runOnce();
      expect(await w.runOnce()).toBe(0);
    });

    it('retry later succeeds → classified, error cleared', async () => {
      const id = await addRecord();
      await worker(failing()).runOnce();
      await ds.query(
        `UPDATE records SET next_attempt_at = now() - interval '1 second' WHERE id = $1`,
        [id],
      );
      await worker(new FakeClassifier()).runOnce();

      expect(await record(id)).toMatchObject({
        class_status: 'classified',
        attempts: 2,
        last_error: null,
      });
    });

    it('fails on the last allowed attempt → failed, no more retries', async () => {
      const id = await addRecord({ attempts: 2 }); // maxAttempts = 3
      await worker(failing()).runOnce();

      expect(await record(id)).toMatchObject({
        class_status: 'failed',
        attempts: 3,
        locked_at: null,
        last_error: 'service down (simulated failure)',
      });
      await ds.query(
        `UPDATE records SET next_attempt_at = now() - interval '1 hour' WHERE id = $1`,
        [id],
      );
      expect(await worker(new FakeClassifier()).runOnce()).toBe(0);
    });

    it('an unexpected error (not a classifier failure) is handled the same way', async () => {
      const id = await addRecord();
      await worker(
        new FakeClassifier(async () => {
          throw new TypeError('boom');
        }),
      ).runOnce();
      expect(await record(id)).toMatchObject({
        class_status: 'pending',
        last_error: 'boom',
      });
    });

    it('one failure in a batch does not affect the others', async () => {
      const bad = await addRecord({ title: 'bad' });
      const good = await addRecord({ title: 'good' });
      await worker(
        new FakeClassifier(async (input) => {
          if (input.title === 'bad') throw new Error('nope');
          return SPORTS;
        }),
      ).runOnce();

      expect((await record(bad)).class_status).toBe('pending');
      expect((await record(good)).class_status).toBe('classified');
    });
  });

  describe('crashed workers (stuck in processing)', () => {
    it('stuck longer than staleLockMs → picked up again and finished', async () => {
      const id = await addRecord({
        class_status: 'processing',
        attempts: 1,
        locked_at: new Date(Date.now() - 31_000),
      });
      expect(await worker(new FakeClassifier()).runOnce()).toBe(1);
      expect(await record(id)).toMatchObject({
        class_status: 'classified',
        attempts: 2,
      });
    });

    it('recently locked (another worker is on it) → left alone', async () => {
      await addRecord({
        class_status: 'processing',
        attempts: 1,
        locked_at: new Date(Date.now() - 5_000),
      });
      expect(await worker(new FakeClassifier()).runOnce()).toBe(0);
    });

    it('stuck with no attempts left → failed', async () => {
      const id = await addRecord({
        class_status: 'processing',
        attempts: 3,
        locked_at: new Date(Date.now() - 31_000),
      });
      const classifier = new FakeClassifier();
      await worker(classifier).runOnce();

      expect(classifier.calls).toEqual([]);
      expect(await record(id)).toMatchObject({
        class_status: 'failed',
        locked_at: null,
        last_error: expect.stringMatching(/stopped/i),
      });
    });

    it('a late result from a worker whose record was taken over is dropped', async () => {
      const id = await addRecord();
      // While this worker classifies, the record is re-locked by another one.
      const slow = new FakeClassifier(async () => {
        await ds.query(
          `UPDATE records SET locked_at = now() + interval '1 second' WHERE id = $1`,
          [id],
        );
        return SPORTS;
      });
      await worker(slow).runOnce();

      expect(await classificationsOf(id)).toEqual([]);
      expect((await record(id)).class_status).toBe('processing');
    });
  });

  describe('several workers at once', () => {
    it('3 workers, 30 records → each classified exactly once', async () => {
      for (let i = 0; i < 30; i++) await addRecord();
      const classifiers = [0, 1, 2].map(
        () =>
          new FakeClassifier(async () => {
            await new Promise((r) => setTimeout(r, 20));
            return SPORTS;
          }),
      );
      const workers = classifiers.map((c) => worker(c, { batchSize: 4 }));

      for (let round = 0; round < 5; round++) {
        await Promise.all(workers.map((w) => w.runOnce()));
      }

      const calls = classifiers.reduce((n, c) => n + c.calls.length, 0);
      expect(calls).toBe(30);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM classifications`,
      );
      expect(n).toBe(30);
      const [{ left }] = await ds.query(
        `SELECT count(*)::int AS left FROM records WHERE class_status <> 'classified'`,
      );
      expect(left).toBe(0);
    });
  });

  describe('start / stop', () => {
    it('start() keeps working through the queue; stop() waits for the current batch', async () => {
      for (let i = 0; i < 5; i++) await addRecord();
      const w = worker(new FakeClassifier(), {
        batchSize: 2,
        pollIntervalMs: 20,
      });

      w.start();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [{ n }] = await ds.query(
          `SELECT count(*)::int AS n FROM records WHERE class_status = 'classified'`,
        );
        if (n === 5) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await w.stop();

      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM records WHERE class_status = 'classified'`,
      );
      expect(n).toBe(5);
      const [{ busy }] = await ds.query(
        `SELECT count(*)::int AS busy FROM records WHERE class_status = 'processing'`,
      );
      expect(busy).toBe(0);
    });
  });
});
