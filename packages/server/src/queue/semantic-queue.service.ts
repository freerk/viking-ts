import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AsyncQueue, QueueStats } from './async-queue';
import { SemanticProcessorService, SemanticJob } from './semantic-processor.service';
import { VfsService } from '../storage/vfs.service';

@Injectable()
export class SemanticQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SemanticQueueService.name);
  private readonly queue = new AsyncQueue<SemanticJob>('semantic', 1);

  constructor(
    private readonly processor: SemanticProcessorService,
    private readonly vfs: VfsService,
  ) {}

  onModuleInit(): void {
    this.queue.setHandler(async (job) => {
      await this.processor.processDirectory(job.data);

      const parentUri = this.vfs.parentUri(job.data.uri);
      if (parentUri && parentUri !== 'viking://') {
        this.enqueue({
          uri: parentUri,
          contextType: job.data.contextType,
          accountId: job.data.accountId,
          ownerSpace: job.data.ownerSpace,
        });
      }
    });
    this.queue.start();
    this.logger.log('Semantic queue started (max concurrency: 1)');
  }

  onModuleDestroy(): void {
    this.queue.stop();
    this.logger.log('Semantic queue stopped');
  }

  enqueue(job: SemanticJob): void {
    this.queue.enqueue(job, job.uri);
  }

  getStats(): QueueStats {
    return this.queue.getStats();
  }
}
