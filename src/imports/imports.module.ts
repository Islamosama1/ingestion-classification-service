import { Module } from '@nestjs/common';
import { RecordsModule } from '../records/records.module';
import { ImportStatusService } from './import-status.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [RecordsModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportStatusService],
})
export class ImportsModule {}
