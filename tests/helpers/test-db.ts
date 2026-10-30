import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Points the app at the test DB. The URL comes only from the environment
// (shell or local .env, never committed), and must not be the dev DB.
export function useTestDatabase(): void {
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
}
