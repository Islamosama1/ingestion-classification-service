import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { InvalidBatchError } from '../imports/record-validation';
import { InvalidQueryError } from './errors';

const CODES: { [status: number]: string } = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

// Every error leaves as { error: { code, message } } (body parser errors are
// answered earlier, in app.setup.ts). Unexpected errors are logged and
// answered with a generic 500 so nothing internal leaks.
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, code, message] = this.describe(exception);
    res.status(status).json({ error: { code, message } });
  }

  private describe(e: unknown): [number, string, string] {
    if (e instanceof InvalidBatchError) {
      return [HttpStatus.BAD_REQUEST, 'invalid_batch', e.message];
    }
    if (e instanceof InvalidQueryError) {
      return [HttpStatus.BAD_REQUEST, 'invalid_query', e.message];
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return [status, CODES[status] ?? 'error', this.messageOf(e)];
    }
    this.logger.error(e instanceof Error ? (e.stack ?? e.message) : e);
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      'internal_error',
      'Internal server error',
    ];
  }

  private messageOf(e: HttpException): string {
    const body = e.getResponse();
    if (typeof body === 'string') return body;
    const message = (body as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('; ');
    return typeof message === 'string' ? message : e.message;
  }
}
