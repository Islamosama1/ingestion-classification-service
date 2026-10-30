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
import { RetryService } from '../records/retry.service';
import {
  ImportItemsPage,
  ImportStatusResult,
  ImportStatusService,
} from './import-status.service';
import { ImportResult, ImportsService } from './imports.service';
import { parseItemsQuery } from './items-query';
import { parseImportBody } from './record-validation';

@Controller('imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly status: ImportStatusService,
    private readonly retries: RetryService,
  ) {}

  // 202: records are stored now; classification happens in the background.
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() body: unknown): Promise<ImportResult> {
    return this.imports.create(parseImportBody(body));
  }

  @Get(':id')
  getStatus(@Param('id') id: string): Promise<ImportStatusResult> {
    return this.status.getStatus(id);
  }

  @Get(':id/items')
  listItems(
    @Param('id') id: string,
    @Query() query: { [k: string]: unknown },
  ): Promise<ImportItemsPage> {
    return this.status.listItems(id, parseItemsQuery(query));
  }

  // 202: the import's failed records are queued again for the worker.
  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Param('id') id: string,
  ): Promise<{ importId: string; requeued: number }> {
    return this.retries.retryImport(id);
  }
}
