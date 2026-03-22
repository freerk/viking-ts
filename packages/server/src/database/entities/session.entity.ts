import {
  Entity,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sessions')
export class SessionEntity {
  @PrimaryColumn()
  id!: string;

  @Index()
  @Column({ name: 'agent_id', nullable: true })
  agentId!: string | null;

  @Index()
  @Column({ name: 'user_id', nullable: true })
  userId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
