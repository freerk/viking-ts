import { DataSource } from 'typeorm';
import {
  MemoryEntity,
  ResourceEntity,
  SkillEntity,
  SessionEntity,
  SessionMessageEntity,
} from './entities';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env['DB_HOST'] || 'localhost',
  port: parseInt(process.env['DB_PORT'] || '5432'),
  username: process.env['DB_USERNAME'] || 'postgres',
  password: process.env['DB_PASSWORD'],
  database: process.env['DB_DATABASE'] || 'viking_ts',
  entities: [MemoryEntity, ResourceEntity, SkillEntity, SessionEntity, SessionMessageEntity],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: process.env['DB_LOGGING'] === 'true',
});
