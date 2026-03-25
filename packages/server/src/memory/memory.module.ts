import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { SessionController as SessionCaptureController } from './session.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [MemoryService],
  controllers: [MemoryController, SessionCaptureController],
  exports: [MemoryService],
})
export class MemoryModule {}
