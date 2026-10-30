import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './api-keys/api-key.guard';
import { ErrorFilter } from './common/error.filter';
import { CoreModule } from './core.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { RecordsModule } from './records/records.module';

@Module({
  imports: [CoreModule, HealthModule, ImportsModule, RecordsModule],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
