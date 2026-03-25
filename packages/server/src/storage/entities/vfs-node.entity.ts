import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('vfs_nodes')
@Index('idx_vfs_parent', ['parentUri'])
export class VfsNodeEntity {
  @PrimaryColumn({ type: 'text' })
  uri!: string;

  @Column({ name: 'parent_uri', type: 'text', nullable: true })
  parentUri!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'is_dir', type: 'integer', default: 0 })
  isDir!: number;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ name: 'content_bytes', type: 'blob', nullable: true })
  contentBytes!: Buffer | null;

  @Column({ type: 'integer', default: 0 })
  size!: number;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
