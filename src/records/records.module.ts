import { Module } from '@nestjs/common';
import { CorrectionsService } from './corrections.service';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { RetryService } from './retry.service';
import { ReviewsController } from './reviews.controller';

@Module({
  controllers: [RecordsController, ReviewsController],
  providers: [RecordsService, CorrectionsService, RetryService],
  // POST /imports/:id/retry uses it too.
  exports: [RetryService],
})
export class RecordsModule {}
