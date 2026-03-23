import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { SessionController } from './session.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [MemoryService],
  controllers: [MemoryController, SessionController],
  exports: [MemoryService],
})
export class MemoryModule {}
