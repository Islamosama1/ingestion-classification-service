import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../api-keys/public.decorator';

type Health = { status: 'ok'; db: 'up' } | { status: 'error'; db: 'down' };

// Answers with its own small body (not the error shape) for monitoring tools.
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<Health> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      // Don't expose the DB error; it can contain hosts or user names.
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', db: 'down' };
    }
    return { status: 'ok', db: 'up' };
  }
}
