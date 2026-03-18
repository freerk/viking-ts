import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { SessionController } from './session.controller';
import { VikingUriModule } from '../viking-uri/viking-uri.module';

@Module({
  imports: [VikingUriModule],
  providers: [MemoryService],
  controllers: [MemoryController, SessionController],
  exports: [MemoryService],
})
export class MemoryModule {}
