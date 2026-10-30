import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
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
}

export type Env = Pick<
  EnvSchema,
  'NODE_ENV' | 'PORT' | 'DATABASE_URL' | 'API_KEY'
>;

// Checks env at startup; throws one error listing every bad variable.
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(EnvSchema, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    DATABASE_URL: env.DATABASE_URL,
    API_KEY: env.API_KEY,
  };
}
