import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUuid } from '../common/errors';
import { CorrectionInput } from './correction-body';
import { HistoryEntry, RecordView, RecordsService } from './records.service';

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly records: RecordsService,
  ) {}

  // Adds a correction as a new classification pointing to the current one;
  // nothing is changed or deleted (the DB refuses that anyway). The record
  // then counts as classified and leaves the review queue.
  async correct(
    recordId: string,
    input: CorrectionInput,
  ): Promise<RecordView & { history: HistoryEntry[] }> {
    if (!isUuid(recordId)) throw new NotFoundException('Record not found');

    await this.dataSource.transaction(async (m) => {
      // Row lock: concurrent corrections of one record run one after the
      // other, each correcting the latest result, so none is lost.
      const [record] = await m.query(
        `SELECT current_classification_id FROM records WHERE id = $1 FOR UPDATE`,
        [recordId],
      );
      if (!record) throw new NotFoundException('Record not found');
      if (!record.current_classification_id) {
        throw new ConflictException(
          'Record has not been classified yet; there is nothing to correct',
        );
      }

      // clock_timestamp(): the real time after the lock, so history order
      // matches the order corrections were made.
      const [{ id }] = await m.query(
        `INSERT INTO classifications
           (record_id, category, needs_review, kind, corrects_id, reason, created_at)
         VALUES ($1, $2, false, 'correction', $3, $4, clock_timestamp())
         RETURNING id`,
        [
          recordId,
          input.category,
          record.current_classification_id,
          input.reason,
        ],
      );
      await m.query(
        `UPDATE records
         SET current_classification_id = $2, class_status = 'classified',
             updated_at = now()
         WHERE id = $1`,
        [recordId, id],
      );
    });

    return this.records.get(recordId);
  }
}
