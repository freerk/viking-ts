import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { RequestContextInterceptor } from './shared/request-context.interceptor';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { LlmModule } from './llm/llm.module';
import { VikingUriModule } from './viking-uri/viking-uri.module';
import { MemoryModule } from './memory/memory.module';
import { ResourceModule } from './resource/resource.module';
import { SkillModule } from './skills/skill.module';
import { FsModule } from './fs/fs.module';
import { ContentModule } from './content/content.module';
import { RelationsModule } from './relations/relations.module';
import { QueueModule } from './queue/queue.module';
import { SearchModule } from './search/search.module';
import { TasksModule } from './tasks/tasks.module';
import { SystemModule } from './system/system.module';
import { SessionModule } from './session/session.module';
import { PackModule } from './pack/pack.module';
import { loadConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
    }),
    HealthModule,
    StorageModule,
    EmbeddingModule,
    LlmModule,
    QueueModule,
    VikingUriModule,
    MemoryModule,
    ResourceModule,
    SkillModule,
    FsModule,
    ContentModule,
    RelationsModule,
    SearchModule,
    TasksModule,
    SystemModule,
    SessionModule,
    PackModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule {}
