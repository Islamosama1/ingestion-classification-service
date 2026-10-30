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
} from 'typeorm';
import { RecordEntity } from '../records/record.entity';
import { Category } from './categories';

export type ClassificationKind = 'auto' | 'correction';

// Append-only: a DB trigger refuses UPDATE and DELETE. A correction is a new
// row pointing to the one it corrects; the original is never changed.
@Entity('classifications')
@Index('IDX_classifications_record', ['recordId'])
@Check(
  'CHK_classifications_category',
  `category IN ('sports', 'culture', 'education', 'business', 'health', 'other')`,
)
@Check(
  'CHK_classifications_confidence',
  'confidence IS NULL OR (confidence >= 0 AND confidence <= 1)',
)
@Check(
  'CHK_classifications_kind',
  `(kind = 'auto' AND confidence IS NOT NULL AND corrects_id IS NULL)
   OR (kind = 'correction' AND corrects_id IS NOT NULL AND reason IS NOT NULL)`,
)
export class Classification {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_classifications',
  })
  id!: string;

  @Column({ name: 'record_id', type: 'uuid' })
  recordId!: string;

  @ManyToOne(() => RecordEntity)
  @JoinColumn({
    name: 'record_id',
    foreignKeyConstraintName: 'FK_classifications_record',
  })
  record?: Relation<RecordEntity>;

  @Column({ type: 'text' })
  category!: Category;

  // pg returns numeric as a string; set only for auto results.
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence!: string | null;

  @Column({ name: 'needs_review', type: 'boolean', default: false })
  needsReview!: boolean;

  @Column({ type: 'text' })
  kind!: ClassificationKind;

  @Column({ name: 'corrects_id', type: 'uuid', nullable: true })
  correctsId!: string | null;

  @ManyToOne(() => Classification)
  @JoinColumn({
    name: 'corrects_id',
    foreignKeyConstraintName: 'FK_classifications_corrects',
  })
  corrects?: Relation<Classification>;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
