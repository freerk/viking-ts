import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { ContextVectorEntity } from '../../src/storage/entities';

/**
 * Returns TypeORM module imports for integration tests that need
 * ContextVectorService (which now uses TypeORM Repository).
 *
 * Usage: spread into the `imports` array of your TestingModule.
 */
export function typeOrmTestImports(tempDir: string) {
  return [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: join(tempDir, 'viking.db'),
      entities: [ContextVectorEntity],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([ContextVectorEntity]),
  ];
}
