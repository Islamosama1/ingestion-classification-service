import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Classifier, ClassifierResult } from '../classification/classifier';
import { retryDelayMs } from './backoff';

export interface WorkerOptions {
  batchSize: number;
  pollIntervalMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  staleLockMs: number;
}

interface Claimed {
  id: string;
  title: string;
  description: string;
  attempts: number;
  // Exact lock time as text (microseconds), used as the claim token.
  lock: string;
}

// Another worker took the record over while this one was classifying.
class LockLostError extends Error {}

const MAX_ERROR_LENGTH = 1000;

// Classifies pending records in the background.
//
// - Claim: due records are locked with FOR UPDATE SKIP LOCKED, so workers
//   never take the same record; the attempt is counted at claim time, so a
//   crash still uses one up.
// - Classify outside any transaction (no DB locks held during the slow call),
//   then save result + status in one short transaction.
// - Every write checks the claim token: a late result from a worker whose
//   record was taken over (stale lock) is dropped, never saved twice.
// - Failure → pending with exponential backoff, or failed after maxAttempts.
// - Records stuck in processing longer than staleLockMs (crashed worker) are
//   claimed again, or failed if no attempts are left.
export class ClassificationWorker {
  private running = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(
    private readonly dataSource: DataSource,
    private readonly classifier: Classifier,
    private readonly options: WorkerOptions,
    private readonly logger = new Logger(ClassificationWorker.name),
  ) {}

  // One round: claim up to batchSize due records and classify them in
  // parallel. Returns how many were claimed.
  async runOnce(): Promise<number> {
    await this.failAbandoned();
    const claimed = await this.claim();
    await Promise.all(claimed.map((r) => this.process(r)));
    return claimed.length;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  // Stops claiming and waits for the current round to finish.
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let claimed = 0;
      try {
        claimed = await this.runOnce();
      } catch (e) {
        // e.g. DB briefly unreachable: log and try again after a pause.
        this.logger.error(`Worker round failed: ${message(e)}`);
      }
      // Busy queue: go again at once; empty: wait (stop() cuts it short).
      if (claimed === 0 && this.running) await this.pause();
    }
  }

  private pause(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, this.options.pollIntervalMs);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private async failAbandoned(): Promise<void> {
    await this.dataSource.query(
      `UPDATE records
       SET class_status = 'failed', locked_at = NULL, updated_at = now(),
           last_error = 'Worker stopped while classifying; no attempts left'
       WHERE class_status = 'processing'
         AND locked_at < now() - make_interval(secs => $1 / 1000.0)
         AND attempts >= $2`,
      [this.options.staleLockMs, this.options.maxAttempts],
    );
  }

  private async claim(): Promise<Claimed[]> {
    const [rows] = await this.dataSource.query(
      `UPDATE records r
       SET class_status = 'processing', locked_at = clock_timestamp(),
           attempts = r.attempts + 1, updated_at = now()
       FROM (
         SELECT id FROM records
         WHERE (class_status = 'pending' AND next_attempt_at <= now())
            OR (class_status = 'processing'
                AND locked_at < now() - make_interval(secs => $2 / 1000.0)
                AND attempts < $3)
         ORDER BY next_attempt_at, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       ) due
       WHERE r.id = due.id
       RETURNING r.id, r.title, r.description, r.attempts, r.locked_at::text AS lock`,
      [
        this.options.batchSize,
        this.options.staleLockMs,
        this.options.maxAttempts,
      ],
    );
    return rows;
  }

  private async process(r: Claimed): Promise<void> {
    let result: ClassifierResult;
    try {
      result = await this.classifier.classify({
        title: r.title,
        description: r.description,
      });
    } catch (e) {
      await this.guard(r, () => this.fail(r, e));
      return;
    }
    await this.guard(r, () => this.save(r, result));
  }

  // Keeps one record's DB trouble from stopping the rest of the batch; a
  // record left in processing is picked up again after staleLockMs.
  private async guard(r: Claimed, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (e) {
      if (e instanceof LockLostError) {
        this.logger.warn(`Record ${r.id} was taken over; result dropped`);
      } else {
        this.logger.error(`Could not save record ${r.id}: ${message(e)}`);
      }
    }
  }

  private async save(r: Claimed, result: ClassifierResult): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const [{ id: classificationId }] = await m.query(
        `INSERT INTO classifications (record_id, category, confidence, needs_review, kind)
         VALUES ($1, $2, $3, $4, 'auto') RETURNING id`,
        [r.id, result.category, result.confidence, result.needsReview],
      );
      const [, updated] = await m.query(
        `UPDATE records
         SET class_status = $2, current_classification_id = $3,
             locked_at = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1 AND class_status = 'processing' AND locked_at = $4::timestamptz`,
        [
          r.id,
          result.needsReview ? 'needs_review' : 'classified',
          classificationId,
          r.lock,
        ],
      );
      // Rolls back the classification insert too.
      if (updated === 0) throw new LockLostError();
    });
  }

  private async fail(r: Claimed, error: unknown): Promise<void> {
    const delay = retryDelayMs(
      r.attempts,
      this.options.retryBaseMs,
      this.options.retryMaxMs,
    );
    const [, updated] = await this.dataSource.query(
      `UPDATE records
       SET class_status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END,
           last_error = $2, locked_at = NULL, updated_at = now(),
           next_attempt_at = now() + make_interval(secs => $4 / 1000.0)
       WHERE id = $1 AND class_status = 'processing' AND locked_at = $5::timestamptz`,
      [
        r.id,
        message(error).slice(0, MAX_ERROR_LENGTH),
        this.options.maxAttempts,
        delay,
        r.lock,
      ],
    );
    if (updated === 0) throw new LockLostError();
  }
}

const message = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
