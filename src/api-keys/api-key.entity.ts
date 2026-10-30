import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('api_keys')
@Unique('UQ_api_keys_key_hash', ['keyHash'])
export class ApiKey {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_api_keys' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  // SHA-256 hex of the key; the key itself is never stored.
  @Column({ name: 'key_hash', type: 'char', length: 64 })
  keyHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
