import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';

// 1000 records × up to ~5 KB each; the 100 KB default would refuse them.
export const JSON_BODY_LIMIT = '10mb';

// Errors raised by the JSON body parser carry a `type`.
const BODY_ERRORS: {
  [type: string]: { status: number; code: string; message: string };
} = {
  'entity.parse.failed': {
    status: 400,
    code: 'invalid_json',
    message: 'Request body is not valid JSON',
  },
  'entity.too.large': {
    status: 413,
    code: 'payload_too_large',
    message: `Request body is larger than ${JSON_BODY_LIMIT}`,
  },
};

// Answers body parser errors in the shared error shape. Nest's own handler
// would turn a parse error into a generic 400 and lose which one it was.
function bodyErrorHandler(
  err: { type?: string },
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const known = err.type ? BODY_ERRORS[err.type] : undefined;
  if (!known) return next(err);
  res
    .status(known.status)
    .json({ error: { code: known.code, message: known.message } });
}

// Shared by main.ts and tests, so tests run the app exactly as deployed.
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  express.use(bodyErrorHandler);
}
