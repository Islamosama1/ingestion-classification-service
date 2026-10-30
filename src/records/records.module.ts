import { Module } from '@nestjs/common';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { ReviewsController } from './reviews.controller';

@Module({
  controllers: [RecordsController, ReviewsController],
  providers: [RecordsService],
})
export class RecordsModule {}
