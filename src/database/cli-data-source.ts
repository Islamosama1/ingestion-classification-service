// Entry point for the TypeORM CLI (migration:run / revert / show).
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env';
import { dataSourceOptions } from './data-source';

// Locally read .env; in Docker the env comes from Compose.
if (existsSync('.env')) process.loadEnvFile('.env');

export default new DataSource(
  dataSourceOptions(validateEnv(process.env).DATABASE_URL),
);
