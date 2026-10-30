import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const IMPORT_STATUSES = ['processing', 'completed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

@Entity('imports')
@Check('CHK_imports_status', `status IN ('processing', 'completed')`)
@Check(
  'CHK_imports_counts',
  'total >= 0 AND created_count >= 0 AND duplicate_count >= 0 AND conflict_count >= 0 AND invalid_count >= 0',
)
export class Import {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_imports' })
  id!: string;

  @Column({ type: 'text', default: 'processing' })
  status!: ImportStatus;

  @Column({ type: 'integer' })
  total!: number;

  @Column({ name: 'created_count', type: 'integer', default: 0 })
  createdCount!: number;

  @Column({ name: 'duplicate_count', type: 'integer', default: 0 })
  duplicateCount!: number;

  @Column({ name: 'conflict_count', type: 'integer', default: 0 })
  conflictCount!: number;

  @Column({ name: 'invalid_count', type: 'integer', default: 0 })
  invalidCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
