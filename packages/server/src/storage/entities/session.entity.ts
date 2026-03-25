import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('sessions')
export class SessionSqliteEntity {
  @PrimaryColumn({ name: 'session_id', type: 'text' })
  sessionId!: string;

  @Column({ name: 'account_id', type: 'text', default: 'default' })
  accountId!: string;

  @Column({ name: 'user_id', type: 'text', default: 'default' })
  userId!: string;

  @Column({ name: 'agent_id', type: 'text', default: 'default' })
  agentId!: string;

  @Column({ type: 'text', default: 'active' })
  status!: string;

  @Column({ name: 'message_count', type: 'integer', default: 0 })
  messageCount!: number;

  @Column({ name: 'contexts_used', type: 'integer', default: 0 })
  contextsUsed!: number;

  @Column({ name: 'skills_used', type: 'integer', default: 0 })
  skillsUsed!: number;

  @Column({ name: 'compression_index', type: 'integer', default: 0 })
  compressionIndex!: number;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt!: string;
}
