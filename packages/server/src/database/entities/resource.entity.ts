import {
  Entity,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('resources')
@Index('resources_embedding_idx', { synchronize: false })
export class ResourceEntity {
  @PrimaryColumn()
  id!: string;

  @Column({ nullable: true })
  title!: string | null;

  @Index()
  @Column()
  uri!: string;

  @Column({ name: 'source_url', nullable: true })
  sourceUrl!: string | null;

  @Column({ name: 'l0_abstract', type: 'text', nullable: true })
  l0Abstract!: string | null;

  @Column({ name: 'l1_overview', type: 'text', nullable: true })
  l1Overview!: string | null;

  @Column({ name: 'l2_content', type: 'text' })
  l2Content!: string;

  @Column({
    type: 'vector',
    length: 768,
    nullable: true,
    transformer: {
      to: (value: number[] | null): string | null =>
        value && value.length > 0 ? `[${value.join(',')}]` : null,
      from: (value: string | null): number[] | null => {
        if (typeof value === 'string') {
          return value.slice(1, -1).split(',').map(Number);
        }
        return null;
      },
    },
  })
  embedding!: number[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
