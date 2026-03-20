import {
  Entity,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('session_messages')
export class SessionMessageEntity {
  @PrimaryColumn()
  id!: string;

  @Index()
  @Column({ name: 'session_id' })
  sessionId!: string;

  @Column()
  role!: string;

  @Column('text')
  content!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
