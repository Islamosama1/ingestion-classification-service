import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RawQuery } from '../common/query';
import { parseCorrectionBody } from './correction-body';
import { CorrectionsService } from './corrections.service';
import { parseRecordsQuery } from './records-query';
import {
  HistoryEntry,
  RecordView,
  RecordsPage,
  RecordsService,
} from './records.service';
import { RetryService } from './retry.service';

@Controller('records')
export class RecordsController {
  constructor(
    private readonly records: RecordsService,
    private readonly corrections: CorrectionsService,
    private readonly retries: RetryService,
  ) {}

  @Get()
  list(@Query() query: RawQuery): Promise<RecordsPage> {
    return this.records.list(parseRecordsQuery(query));
  }

  @Get(':id')
  get(
    @Param('id') id: string,
  ): Promise<RecordView & { history: HistoryEntry[] }> {
    return this.records.get(id);
  }

  // 201 with the record as GET /records/:id would now return it.
  @Post(':id/corrections')
  correct(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RecordView & { history: HistoryEntry[] }> {
    return this.corrections.correct(id, parseCorrectionBody(body));
  }

  // 202: queued again; the worker classifies it in the background.
  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Param('id') id: string,
  ): Promise<RecordView & { history: HistoryEntry[] }> {
    return this.retries.retryRecord(id);
  }
}
