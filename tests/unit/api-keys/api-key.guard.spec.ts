import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ApiKeyGuard } from '../../../src/api-keys/api-key.guard';
import { Public } from '../../../src/api-keys/public.decorator';
import { HealthController } from '../../../src/health/health.controller';

const KEY = 'test-api-key-0000';

@Controller()
class TestController {
  @Get('protected')
  protectedRoute(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }
}

describe('ApiKeyGuard (global, single API_KEY)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController, HealthController],
      providers: [
        { provide: APP_GUARD, useClass: ApiKeyGuard },
        { provide: ConfigService, useValue: { get: () => KEY } },
        {
          provide: DataSource,
          useValue: { query: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, key?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return key === undefined ? req : req.set('X-API-Key', key);
  };

  it('no X-API-Key → 401', async () => {
    expect((await get('/protected')).status).toBe(401);
  });

  it('empty X-API-Key → 401', async () => {
    expect((await get('/protected', '')).status).toBe(401);
  });

  it('wrong key → 401', async () => {
    expect((await get('/protected', 'wrong-api-key-0000')).status).toBe(401);
  });

  it('key that only starts like the real one → 401', async () => {
    expect((await get('/protected', KEY.slice(0, -1))).status).toBe(401);
    expect((await get('/protected', KEY + 'x')).status).toBe(401);
  });

  it('same answer for missing and wrong key (no hint why)', async () => {
    const missing = await get('/protected');
    const wrong = await get('/protected', 'wrong-api-key-0000');
    expect(wrong.body).toEqual(missing.body);
  });

  it('correct key → 200', async () => {
    expect((await get('/protected', KEY)).status).toBe(200);
  });

  it('header name in any letter case', async () => {
    const res = await request(app.getHttpServer())
      .get('/protected')
      .set('x-api-key', KEY);
    expect(res.status).toBe(200);
  });

  it('@Public() route → 200 without a key', async () => {
    expect((await get('/open')).status).toBe(200);
  });

  it('GET /health → 200 without a key', async () => {
    expect((await get('/health')).status).toBe(200);
  });
});
