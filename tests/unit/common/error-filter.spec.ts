import {
  Body,
  Controller,
  Get,
  INestApplication,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../../src/app.setup';
import { ErrorFilter } from '../../../src/common/error.filter';
import { InvalidBatchError } from '../../../src/imports/record-validation';

@Controller()
class ThrowingController {
  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Import not found');
  }

  @Get('bad-batch')
  badBatch(): never {
    throw new InvalidBatchError('"records" must be an array');
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection to db-host:5432 failed for user secret');
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe('ErrorFilter: one error shape { error: { code, message } }', () => {
  let app: INestApplication;
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
      providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    quiet.mockRestore();
  });

  it('HttpException 404 → not_found with its message', async () => {
    const res = await request(app.getHttpServer()).get('/not-found');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'not_found', message: 'Import not found' },
    });
  });

  it('unknown route → 404 not_found', async () => {
    const res = await request(app.getHttpServer()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('InvalidBatchError → 400 invalid_batch with its message', async () => {
    const res = await request(app.getHttpServer()).get('/bad-batch');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'invalid_batch', message: '"records" must be an array' },
    });
  });

  it('unexpected error → 500 internal_error, nothing leaked', async () => {
    const res = await request(app.getHttpServer()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|db-host|stack/);
  });

  it('malformed JSON body → 400 invalid_json', async () => {
    const res = await request(app.getHttpServer())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"records": [');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('body over the size limit → 413 payload_too_large', async () => {
    const res = await request(app.getHttpServer())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ big: 'x'.repeat(11 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });

  it('a 6 MB body (1000 max-size records) is accepted', async () => {
    const res = await request(app.getHttpServer())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ big: 'x'.repeat(6 * 1024 * 1024) }));
    expect(res.status).toBe(201);
  });
});
