import { Entity, Column, PrimaryColumn, Index, Unique } from 'typeorm';

@Entity('relations')
@Unique(['fromUri', 'toUri'])
@Index('idx_rel_from', ['fromUri'])
export class RelationEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'from_uri', type: 'text' })
  fromUri!: string;

  @Column({ name: 'to_uri', type: 'text' })
  toUri!: string;

  @Column({ type: 'text', default: '' })
  reason!: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
