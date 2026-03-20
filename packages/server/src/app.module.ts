import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { LlmModule } from './llm/llm.module';
import { VikingUriModule } from './viking-uri/viking-uri.module';
import { MemoryModule } from './memory/memory.module';
import { ResourceModule } from './resource/resource.module';
import { SkillModule } from './skills/skill.module';
import { loadConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
    }),
    HealthModule,
    StorageModule.register(),
    EmbeddingModule,
    LlmModule,
    VikingUriModule,
    MemoryModule,
    ResourceModule,
    SkillModule,
  ],
})
export class AppModule {}
