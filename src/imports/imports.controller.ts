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
}
