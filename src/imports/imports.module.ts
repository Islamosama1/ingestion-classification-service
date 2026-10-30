import { Module } from '@nestjs/common';
import { ImportStatusService } from './import-status.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, ImportStatusService],
})
export class ImportsModule {}
