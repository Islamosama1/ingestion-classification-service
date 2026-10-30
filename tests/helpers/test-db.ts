import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../src/database/data-source';

// Points the app at the test DB. The URL comes only from the environment
// (shell or local .env, never committed), and must not be the dev DB.
// Fixed key for tests, so they don't depend on the developer's .env.
export const TEST_API_KEY = 'test-api-key-0000';

let applied = false;

export function useTestDatabase(): void {
  // Once switched, DATABASE_URL is the test URL; checking again would misfire.
  if (applied) return;

  // Jest gives tests their own process.env, so copy .env values in by hand.
  // Shell values win over .env.
  if (existsSync('.env')) {
    const fileEnv = parseEnv(readFileSync('.env', 'utf8'));
    for (const [key, value] of Object.entries(fileEnv)) {
      process.env[key] ??= value;
    }
  }

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = url;
  process.env.API_KEY = TEST_API_KEY;
  applied = true;
}

// Empties the test DB and runs every migration from scratch.
export async function freshMigratedDataSource(): Promise<DataSource> {
  useTestDatabase();
  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL!));
  await ds.initialize();
  await ds.dropDatabase();
  await ds.runMigrations();
  return ds;
}
