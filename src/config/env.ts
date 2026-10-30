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
  if (problems.length > 0) {
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }
  return Object.fromEntries(KEYS.map((k) => [k, env[k]])) as Env;
}
