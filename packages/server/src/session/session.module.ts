import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionExtractorService } from './session-extractor.service';
import { SessionMemoryWriterService } from './session-memory-writer.service';
import { SessionController } from './session.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [SessionService, SessionExtractorService, SessionMemoryWriterService],
  controllers: [SessionController],
  exports: [SessionService],
})
export class SessionModule {}
