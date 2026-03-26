import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { DatabaseService } from './database.service';
import { VfsService } from './vfs.service';
import { ContextVectorService } from './context-vector.service';
import { RelationsService } from './relations.service';
import {
  ContextVectorEntity,
  VfsNodeEntity,
  RelationEntity,
  SessionEntity,
  SessionMessageEntity,
} from './entities';

const entities = [
  ContextVectorEntity,
  VfsNodeEntity,
  RelationEntity,
  SessionEntity,
  SessionMessageEntity,
];

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const storagePath = config.get<string>('storage.path', '~/.viking-ts/data');
        return {
          type: 'better-sqlite3' as const,
          database: join(storagePath, 'viking.db'),
          entities,
          synchronize: false,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  providers: [DatabaseService, VfsService, ContextVectorService, RelationsService],
  exports: [DatabaseService, VfsService, ContextVectorService, RelationsService, TypeOrmModule],
})
export class StorageModule {}
