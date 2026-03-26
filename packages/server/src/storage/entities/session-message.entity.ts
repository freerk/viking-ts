import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('session_messages')
@Index('idx_sm_session', ['sessionId'])
export class SessionMessageEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'session_id', type: 'text' })
  sessionId!: string;

  @Column({ type: 'text' })
  role!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt!: string;
}
