import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionExtractorService } from './session-extractor.service';
import { SessionMemoryWriterService } from './session-memory-writer.service';
import { MemoryDeduplicatorService } from './memory-deduplicator.service';
import { DirectoryInitializerService } from '../storage/directory-initializer.service';
import { SessionController } from './session.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [
    SessionService,
    SessionExtractorService,
    SessionMemoryWriterService,
    MemoryDeduplicatorService,
    DirectoryInitializerService,
  ],
  controllers: [SessionController],
  exports: [SessionService, DirectoryInitializerService],
})
export class SessionModule {}
