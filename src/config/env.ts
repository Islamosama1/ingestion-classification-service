import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;

class EnvSchema {
  @IsIn(NODE_ENVS)
  NODE_ENV: (typeof NODE_ENVS)[number] = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres:// URL',
  })
  DATABASE_URL!: string;

  // Clients send it as X-API-Key on every request (except /health).
  @IsString()
  @MinLength(16)
  API_KEY!: string;

  // Mock classifier: each call waits a random time in [min, max] ms and
  // fails with this probability, like a slow, flaky external service.
  @IsInt()
  @Min(0)
  @Max(60000)
  CLASSIFIER_MIN_DELAY_MS: number = 200;

  @IsInt()
  @Min(0)
  @Max(60000)
  CLASSIFIER_MAX_DELAY_MS: number = 1500;

  @IsNumber()
  @Min(0)
  @Max(1)
  CLASSIFIER_FAILURE_RATE: number = 0.1;

  // Results with lower confidence are flagged for manual review.
  @IsNumber()
  @Min(0)
  @Max(1)
  REVIEW_THRESHOLD: number = 0.7;

  // Worker: records claimed per round (also classified in parallel).
  @IsInt()
  @Min(1)
  @Max(100)
  WORKER_BATCH_SIZE: number = 10;

  // Wait before looking again when nothing is due.
  @IsInt()
  @Min(10)
  @Max(600000)
  WORKER_POLL_INTERVAL_MS: number = 1000;

  // Attempts per record before it is marked failed.
  @IsInt()
  @Min(1)
  @Max(20)
  WORKER_MAX_ATTEMPTS: number = 5;

  // Retry wait doubles after each failed attempt, from base up to max.
  @IsInt()
  @Min(0)
  @Max(86400000)
  WORKER_RETRY_BASE_MS: number = 2000;

  @IsInt()
  @Min(0)
  @Max(86400000)
  WORKER_RETRY_MAX_MS: number = 60000;

  // A record locked longer than this is treated as abandoned (worker crash).
  @IsInt()
  @Min(1)
  @Max(86400000)
  WORKER_STALE_LOCK_MS: number = 60000;
}

const KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'API_KEY',
  'CLASSIFIER_MIN_DELAY_MS',
  'CLASSIFIER_MAX_DELAY_MS',
  'CLASSIFIER_FAILURE_RATE',
  'REVIEW_THRESHOLD',
  'WORKER_BATCH_SIZE',
  'WORKER_POLL_INTERVAL_MS',
  'WORKER_MAX_ATTEMPTS',
  'WORKER_RETRY_BASE_MS',
  'WORKER_RETRY_MAX_MS',
  'WORKER_STALE_LOCK_MS',
] as const;

export type Env = Pick<EnvSchema, (typeof KEYS)[number]>;

// Checks env at startup; throws one error listing every bad variable.
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(EnvSchema, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const problems = validateSync(env).map(
    (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
  );
  if (env.CLASSIFIER_MAX_DELAY_MS < env.CLASSIFIER_MIN_DELAY_MS) {
    problems.push(
      'CLASSIFIER_MAX_DELAY_MS: must not be below CLASSIFIER_MIN_DELAY_MS',
    );
  }
  if (env.WORKER_RETRY_MAX_MS < env.WORKER_RETRY_BASE_MS) {
    problems.push(
      'WORKER_RETRY_MAX_MS: must not be below WORKER_RETRY_BASE_MS',
    );
  }
  // Otherwise a slow but healthy call would be taken over by another worker.
  if (env.WORKER_STALE_LOCK_MS <= env.CLASSIFIER_MAX_DELAY_MS) {
    problems.push(
      'WORKER_STALE_LOCK_MS: must be above CLASSIFIER_MAX_DELAY_MS',
    );
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }
  return Object.fromEntries(KEYS.map((k) => [k, env[k]])) as Env;
}
