import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { HealthController } from '../../../src/health/health.controller';

async function appWithDb(query: jest.Mock): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DataSource, useValue: { query } }],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('GET /health', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 and db up when the DB answers', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    app = await appWithDb(query);

    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns 503 and db down when the DB fails', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connection refused'));
    app = await appWithDb(query);

    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
  });

  it('does not leak the DB error message', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(
        new Error('password authentication failed for user "secret"'),
      );
    app = await appWithDb(query);

    const res = await request(app.getHttpServer()).get('/health');

    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
