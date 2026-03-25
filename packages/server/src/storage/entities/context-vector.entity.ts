import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('context_vectors')
@Index('idx_cv_uri', ['uri'])
@Index('idx_cv_parent', ['parentUri'])
@Index('idx_cv_context_type', ['contextType'])
@Index('idx_cv_level', ['level'])
@Index('idx_cv_account', ['accountId'])
export class ContextVectorEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text', unique: true })
  uri!: string;

  @Column({ name: 'parent_uri', type: 'text', nullable: true })
  parentUri!: string | null;

  @Column({ type: 'text', default: 'file' })
  type!: string;

  @Column({ name: 'context_type', type: 'text' })
  contextType!: string;

  @Column({ type: 'integer', default: 2 })
  level!: number;

  @Column({ type: 'text', default: '' })
  abstract!: string;

  @Column({ type: 'text', default: '' })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'text', default: '' })
  tags!: string;

  @Column({ name: 'account_id', type: 'text', default: 'default' })
  accountId!: string;

  @Column({ name: 'owner_space', type: 'text', default: '' })
  ownerSpace!: string;

  @Column({ name: 'active_count', type: 'integer', default: 0 })
  activeCount!: number;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;

  @Column({ name: 'embedding_json', type: 'text', nullable: true })
  embeddingJson!: string | null;
}
