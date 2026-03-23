import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmbeddingQueueService } from './embedding-queue.service';
import { SemanticQueueService } from './semantic-queue.service';
import { ApiResponse } from '../shared/types';
import { QueueStats } from './async-queue';
import { okResponse } from '../shared/api-response.helper';

interface QueueStatusResult {
  semantic: QueueStats;
  embedding: QueueStats;
}

@ApiTags('observer')
@Controller('api/v1/observer')
export class ObserverController {
  constructor(
    private readonly embeddingQueue: EmbeddingQueueService,
    private readonly semanticQueue: SemanticQueueService,
  ) {}

  @Get('queues')
  @ApiOperation({ summary: 'Get queue processing status' })
  getQueues(): ApiResponse<QueueStatusResult> {
    return okResponse({
      semantic: this.semanticQueue.getStats(),
      embedding: this.embeddingQueue.getStats(),
    });
  }
}
