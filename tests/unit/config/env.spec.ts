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
      CLASSIFIER_MIN_DELAY_MS: 200,
      CLASSIFIER_MAX_DELAY_MS: 1500,
      CLASSIFIER_FAILURE_RATE: 0.1,
      REVIEW_THRESHOLD: 0.7,
      WORKER_BATCH_SIZE: 10,
      WORKER_POLL_INTERVAL_MS: 1000,
      WORKER_MAX_ATTEMPTS: 5,
      WORKER_RETRY_BASE_MS: 2000,
      WORKER_RETRY_MAX_MS: 60000,
      WORKER_STALE_LOCK_MS: 60000,
    });
  });

  describe('worker settings', () => {
    it.each([
      ['WORKER_BATCH_SIZE', '0'],
      ['WORKER_BATCH_SIZE', '101'],
      ['WORKER_POLL_INTERVAL_MS', '5'],
      ['WORKER_MAX_ATTEMPTS', '0'],
      ['WORKER_MAX_ATTEMPTS', '21'],
      ['WORKER_RETRY_BASE_MS', '-1'],
      ['WORKER_RETRY_MAX_MS', 'soon'],
      ['WORKER_STALE_LOCK_MS', '1.5'],
    ])('refuses %s=%s and names it', (name, value) => {
      expect(() => validateEnv({ ...valid, [name]: value })).toThrow(
        new RegExp(name),
      );
    });

    it('refuses a retry max below the retry base', () => {
      expect(() =>
        validateEnv({
          ...valid,
          WORKER_RETRY_BASE_MS: '5000',
          WORKER_RETRY_MAX_MS: '1000',
        }),
      ).toThrow(/WORKER_RETRY_MAX_MS/);
    });

    it('refuses a stale-lock time not above the classifier max delay', () => {
      // Otherwise a slow but healthy call would be taken over by another worker.
      expect(() =>
        validateEnv({
          ...valid,
          CLASSIFIER_MAX_DELAY_MS: '5000',
          WORKER_STALE_LOCK_MS: '5000',
        }),
      ).toThrow(/WORKER_STALE_LOCK_MS/);
    });
  });

  describe('classifier settings', () => {
    it('reads numbers from strings', () => {
      expect(
        validateEnv({
          ...valid,
          CLASSIFIER_MIN_DELAY_MS: '0',
          CLASSIFIER_MAX_DELAY_MS: '50',
          CLASSIFIER_FAILURE_RATE: '0.25',
          REVIEW_THRESHOLD: '0.9',
        }),
      ).toMatchObject({
        CLASSIFIER_MIN_DELAY_MS: 0,
        CLASSIFIER_MAX_DELAY_MS: 50,
        CLASSIFIER_FAILURE_RATE: 0.25,
        REVIEW_THRESHOLD: 0.9,
      });
    });

    it.each([
      ['CLASSIFIER_FAILURE_RATE', '0'],
      ['CLASSIFIER_FAILURE_RATE', '1'],
      ['REVIEW_THRESHOLD', '0'],
      ['REVIEW_THRESHOLD', '1'],
    ])('accepts %s=%s (range ends)', (name, value) => {
      expect(() => validateEnv({ ...valid, [name]: value })).not.toThrow();
    });

    it.each([
      ['CLASSIFIER_MIN_DELAY_MS', '-1'],
      ['CLASSIFIER_MIN_DELAY_MS', '1.5'],
      ['CLASSIFIER_MAX_DELAY_MS', 'slow'],
      ['CLASSIFIER_MAX_DELAY_MS', '60001'],
      ['CLASSIFIER_FAILURE_RATE', '-0.1'],
      ['CLASSIFIER_FAILURE_RATE', '1.5'],
      ['REVIEW_THRESHOLD', '2'],
      ['REVIEW_THRESHOLD', 'high'],
    ])('refuses %s=%s and names it', (name, value) => {
      expect(() => validateEnv({ ...valid, [name]: value })).toThrow(
        new RegExp(name),
      );
    });

    it('refuses a max delay below the min delay', () => {
      expect(() =>
        validateEnv({
          ...valid,
          CLASSIFIER_MIN_DELAY_MS: '500',
          CLASSIFIER_MAX_DELAY_MS: '100',
        }),
      ).toThrow(/CLASSIFIER_MAX_DELAY_MS/);
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
