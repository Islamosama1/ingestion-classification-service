import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TEST_API_KEY, useTestDatabase } from '../helpers/test-db';

@Controller()
class ProbeController {
  @Get('probe')
  probe(): { ok: true } {
    return { ok: true };
  }
}

// Full app: the guard is wired globally and reads API_KEY from env.
describe('API key check end to end (full app)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    useTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('API_KEY from env → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set('X-API-Key', TEST_API_KEY);
    expect(res.status).toBe(200);
  });

  it('no key / wrong key → 401', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/probe')).status).toBe(401);
    expect(
      (
        await request(server)
          .get('/probe')
          .set('X-API-Key', 'wrong-api-key-0000')
      ).status,
    ).toBe(401);
  });

  it('/health → 200 without a key', async () => {
    expect((await request(app.getHttpServer()).get('/health')).status).toBe(
      200,
    );
  });
});
