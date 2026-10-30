import { Controller, Get, Param, Query } from '@nestjs/common';
import { RawQuery } from '../common/query';
import { parseRecordsQuery } from './records-query';
import {
  HistoryEntry,
  RecordView,
  RecordsPage,
  RecordsService,
} from './records.service';

@Controller('records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

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
}
