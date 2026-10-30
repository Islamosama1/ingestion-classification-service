import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Classification } from '../classification/classification.entity';
import { Import } from '../imports/import.entity';

export const CLASS_STATUSES = [
  'pending',
  'processing',
  'classified',
  'needs_review',
  'failed',
] as const;
export type ClassStatus = (typeof CLASS_STATUSES)[number];

@Entity('records')
// Blocks duplicates, also across concurrent imports.
@Unique('UQ_records_source_external_id', ['source', 'externalId'])
// Worker claim: next due records by status.
@Index('IDX_records_claim', ['classStatus', 'nextAttemptAt'])
@Index('IDX_records_import', ['importId'])
@Index('IDX_records_effective_date', ['effectiveDate'])
@Check(
  'CHK_records_class_status',
  `class_status IN ('pending', 'processing', 'classified', 'needs_review', 'failed')`,
)
@Check('CHK_records_attempts', 'attempts >= 0')
export class RecordEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_records' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  source!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 5000 })
  description!: string;

  @Column({ name: 'effective_date', type: 'timestamptz' })
  effectiveDate!: Date;

  // SHA-256 of title + description + date: tells a duplicate from a conflict.
  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash!: string;

  @Column({ name: 'import_id', type: 'uuid' })
  importId!: string;

  @ManyToOne(() => Import)
  @JoinColumn({
    name: 'import_id',
    foreignKeyConstraintName: 'FK_records_import',
  })
  import?: Relation<Import>;

  @Column({ name: 'class_status', type: 'text', default: 'pending' })
  classStatus!: ClassStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({
    name: 'next_attempt_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  nextAttemptAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'current_classification_id', type: 'uuid', nullable: true })
  currentClassificationId!: string | null;

  @ManyToOne(() => Classification)
  @JoinColumn({
    name: 'current_classification_id',
    foreignKeyConstraintName: 'FK_records_current_classification',
  })
  currentClassification?: Relation<Classification>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
