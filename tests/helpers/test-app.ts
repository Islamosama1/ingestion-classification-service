import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { configureApp } from '../../src/app.setup';
import { AppModule } from '../../src/app.module';

// Full app as in production (filters, guard, body limit) on the test DB.
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

// Removes every row the tests wrote (TRUNCATE skips the append-only trigger,
// which only blocks UPDATE / DELETE).
export async function clearData(ds: DataSource): Promise<void> {
  await ds.query(
    'TRUNCATE import_items, classifications, records, imports CASCADE',
  );
}
