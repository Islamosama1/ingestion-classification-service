import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUuid } from '../common/errors';
import { HistoryEntry, RecordView, RecordsService } from './records.service';

// Back to the worker's queue with a full set of attempts, due now. The last
// error stays visible until the next attempt replaces or clears it.
const REQUEUE = `class_status = 'pending', attempts = 0, locked_at = NULL,
                 next_attempt_at = now(), updated_at = now()`;

// Recovers failed records. Only `failed` ones are touched, in a single
// guarded UPDATE: nothing is created, successful work is never redone, and
// a repeated or concurrent call can't queue a record twice.
@Injectable()
export class RetryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly records: RecordsService,
  ) {}

  async retryRecord(
    recordId: string,
  ): Promise<RecordView & { history: HistoryEntry[] }> {
    if (!isUuid(recordId)) throw new NotFoundException('Record not found');

    const [requeued] = await this.dataSource.query(
      `UPDATE records SET ${REQUEUE}
       WHERE id = $1 AND class_status = 'failed' RETURNING id`,
      [recordId],
    );
    if (requeued.length === 0) {
      const [record] = await this.dataSource.query(
        `SELECT class_status FROM records WHERE id = $1`,
        [recordId],
      );
      if (!record) throw new NotFoundException('Record not found');
      throw new ConflictException(
        `Only failed records can be retried; this record is ${record.class_status}`,
      );
    }
    return this.records.get(recordId);
  }

  // Requeues the failed records this import created (not records it only
  // found as duplicates: those belong to the import that created them).
  async retryImport(
    importId: string,
  ): Promise<{ importId: string; requeued: number }> {
    const [found] = isUuid(importId)
      ? await this.dataSource.query(`SELECT id FROM imports WHERE id = $1`, [
          importId,
        ])
      : [];
    if (!found) throw new NotFoundException('Import not found');

    const [, requeued] = await this.dataSource.query(
      `UPDATE records SET ${REQUEUE}
       WHERE import_id = $1 AND class_status = 'failed'`,
      [importId],
    );
    return { importId, requeued };
  }
}
