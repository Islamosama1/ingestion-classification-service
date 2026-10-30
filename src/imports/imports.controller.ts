import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ImportResult, ImportsService } from './imports.service';
import { parseImportBody } from './record-validation';

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  // 202: records are stored now; classification happens in the background.
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() body: unknown): Promise<ImportResult> {
    return this.imports.create(parseImportBody(body));
  }
}
