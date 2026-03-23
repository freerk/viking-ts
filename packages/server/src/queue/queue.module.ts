import { Module } from '@nestjs/common';
import { EmbeddingQueueService } from './embedding-queue.service';
import { SemanticQueueService } from './semantic-queue.service';
import { SemanticProcessorService } from './semantic-processor.service';
import { ObserverController } from './observer.controller';

@Module({
  providers: [
    EmbeddingQueueService,
    SemanticQueueService,
    SemanticProcessorService,
  ],
  controllers: [ObserverController],
  exports: [EmbeddingQueueService, SemanticQueueService, SemanticProcessorService],
})
export class QueueModule {}
