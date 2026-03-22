import { Module, Global, DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VectorStoreService } from './vector-store.service';
import { MetadataStoreService } from './metadata-store.service';
import { PostgresMetadataStoreService } from '../database/postgres/postgres-metadata-store.service';
import { PostgresVectorStoreService } from '../database/postgres/postgres-vector-store.service';
import {
  MemoryEntity,
  ResourceEntity,
  SkillEntity,
  SessionEntity,
  SessionMessageEntity,
} from '../database/entities';

@Global()
@Module({})
export class StorageModule {
  static register(): DynamicModule {
    const isPostgres = process.env['STORAGE_BACKEND'] === 'postgres';

    if (isPostgres) {
      return {
        module: StorageModule,
        imports: [
          TypeOrmModule.forRoot({
            type: 'postgres',
            host: process.env['DB_HOST'] || 'localhost',
            port: parseInt(process.env['DB_PORT'] || '5432'),
            username: process.env['DB_USERNAME'] || 'postgres',
            password: process.env['DB_PASSWORD'],
            database: process.env['DB_DATABASE'] || 'viking_ts',
            entities: [MemoryEntity, ResourceEntity, SkillEntity, SessionEntity, SessionMessageEntity],
            synchronize: false,
            logging: process.env['DB_LOGGING'] === 'true',
          }),
          TypeOrmModule.forFeature([
            MemoryEntity,
            ResourceEntity,
            SkillEntity,
            SessionEntity,
            SessionMessageEntity,
          ]),
        ],
        providers: [
          {
            provide: MetadataStoreService,
            useClass: PostgresMetadataStoreService,
          },
          {
            provide: VectorStoreService,
            useClass: PostgresVectorStoreService,
          },
        ],
        exports: [MetadataStoreService, VectorStoreService],
      };
    }

    return {
      module: StorageModule,
      providers: [VectorStoreService, MetadataStoreService],
      exports: [VectorStoreService, MetadataStoreService],
    };
  }
}
