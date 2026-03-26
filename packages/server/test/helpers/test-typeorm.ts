import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import {
  ContextVectorEntity,
  VfsNodeEntity,
  RelationEntity,
  SessionEntity,
  SessionMessageEntity,
} from '../../src/storage/entities';

const entities = [
  ContextVectorEntity,
  VfsNodeEntity,
  RelationEntity,
  SessionEntity,
  SessionMessageEntity,
];

/**
 * Returns TypeORM module imports for integration tests.
 *
 * Usage: spread into the `imports` array of your TestingModule.
 */
export function typeOrmTestImports(tempDir: string) {
  return [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: join(tempDir, 'viking.db'),
      entities,
      synchronize: true,
    }),
    TypeOrmModule.forFeature(entities),
  ];
}
