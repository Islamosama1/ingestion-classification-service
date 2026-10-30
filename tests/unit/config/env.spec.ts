import { validateEnv } from '../../../src/config/env';

const valid = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgres://localhost:5432/ingestion',
  API_KEY: 'test-api-key-0000',
};

describe('validateEnv', () => {
  it('accepts a valid env and converts PORT to a number', () => {
    expect(validateEnv(valid)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgres://localhost:5432/ingestion',
      API_KEY: 'test-api-key-0000',
    });
  });

  it('defaults PORT to 3000 and NODE_ENV to development', () => {
    const env = validateEnv({
      DATABASE_URL: valid.DATABASE_URL,
      API_KEY: valid.API_KEY,
    });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('refuses a missing DATABASE_URL and names it', () => {
    expect(() => validateEnv({ PORT: '3000' })).toThrow(/DATABASE_URL/);
  });

  it('refuses a DATABASE_URL that is not a postgres URL', () => {
    expect(() =>
      validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it.each(['abc', '0', '70000', '3000.5'])('refuses PORT=%s', (port) => {
    expect(() => validateEnv({ ...valid, PORT: port })).toThrow(/PORT/);
  });

  it('refuses an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('refuses a missing API_KEY and names it', () => {
    const withoutKey: { [k: string]: string } = { ...valid };
    delete withoutKey.API_KEY;
    expect(() => validateEnv(withoutKey)).toThrow(/API_KEY/);
  });

  it.each(['', 'short-key', 'x'.repeat(15)])(
    'refuses API_KEY=%p (under 16 chars)',
    (key) => {
      expect(() => validateEnv({ ...valid, API_KEY: key })).toThrow(/API_KEY/);
    },
  );

  it('accepts an API_KEY of exactly 16 chars', () => {
    expect(validateEnv({ ...valid, API_KEY: 'x'.repeat(16) }).API_KEY).toBe(
      'x'.repeat(16),
    );
  });

  it('lists every bad variable in one error', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(
      /PORT[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*PORT/,
    );
  });
});
