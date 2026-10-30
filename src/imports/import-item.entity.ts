import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
} from 'typeorm';
import { RecordEntity } from '../records/record.entity';
import { Import } from './import.entity';

export const ITEM_OUTCOMES = [
  'created',
  'duplicate',
  'conflict',
  'invalid',
] as const;
export type ItemOutcome = (typeof ITEM_OUTCOMES)[number];

export interface FieldError {
  field: string;
  message: string;
}

// One row per submitted record: the feedback the client gets back.
@Entity('import_items')
@Unique('UQ_import_items_import_index', ['importId', 'index'])
@Index('IDX_import_items_import_outcome', ['importId', 'outcome'])
@Check(
  'CHK_import_items_outcome',
  `outcome IN ('created', 'duplicate', 'conflict', 'invalid')`,
)
// Invalid items have no record; every other outcome points to one.
@Check('CHK_import_items_record', `(outcome = 'invalid') = (record_id IS NULL)`)
export class ImportItem {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_import_items',
  })
  id!: string;

  @Column({ name: 'import_id', type: 'uuid' })
  importId!: string;

  @ManyToOne(() => Import)
  @JoinColumn({
    name: 'import_id',
    foreignKeyConstraintName: 'FK_import_items_import',
  })
  import?: Relation<Import>;

  // Position of the record in the submitted batch (0-based).
  @Column({ type: 'integer' })
  index!: number;

  // Raw values as submitted (text: invalid input may be over the limits).
  @Column({ name: 'external_id', type: 'text', nullable: true })
  externalId!: string | null;

  @Column({ type: 'text', nullable: true })
  source!: string | null;

  @Column({ type: 'text' })
  outcome!: ItemOutcome;

  @Column({ type: 'jsonb', nullable: true })
  errors!: FieldError[] | null;

  @Column({ name: 'record_id', type: 'uuid', nullable: true })
  recordId!: string | null;

  @ManyToOne(() => RecordEntity)
  @JoinColumn({
    name: 'record_id',
    foreignKeyConstraintName: 'FK_import_items_record',
  })
  record?: Relation<RecordEntity>;
}
