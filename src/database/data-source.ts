import 'reflect-metadata';
import { DataSourceOptions } from 'typeorm';
import { Classification } from '../classification/classification.entity';
import { ImportItem } from '../imports/import-item.entity';
import { Import } from '../imports/import.entity';
import { RecordEntity } from '../records/record.entity';
import { InitialSchema1761800000000 } from './migrations/1761800000000-InitialSchema';
import { DropApiKeys1761900000000 } from './migrations/1761900000000-DropApiKeys';

export const ENTITIES = [Import, ImportItem, RecordEntity, Classification];

const MIGRATIONS = [InitialSchema1761800000000, DropApiKeys1761900000000];

// Shared by the app, the migration CLI and tests.
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    // gen_random_uuid() is built into Postgres 13+; no extension needed.
    uuidExtension: 'pgcrypto',
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'migrations',
    // Schema changes go through migrations only.
    synchronize: false,
  };
}
