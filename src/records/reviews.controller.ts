import { Controller, Get, Query } from '@nestjs/common';
import { RawQuery } from '../common/query';
import { parseReviewsQuery } from './records-query';
import { RecordsPage, RecordsService } from './records.service';

// The manual review queue: records whose classification needs a person,
// longest waiting first.
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  list(@Query() query: RawQuery): Promise<RecordsPage> {
    return this.records.list(parseReviewsQuery(query), 'longestWaiting');
  }
}
