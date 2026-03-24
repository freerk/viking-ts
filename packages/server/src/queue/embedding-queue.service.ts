import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service';
import { ContextVectorService } from '../storage/context-vector.service';
import { AsyncQueue, QueueStats } from './async-queue';

export interface EmbeddingJob {
  uri: string;
  text: string;
  contextType: 'memory' | 'resource' | 'skill';
  level: 0 | 1 | 2;
  abstract: string;
  name: string;
  parentUri: string | null;
  accountId: string;
  ownerSpace: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

@Injectable()
export class EmbeddingQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingQueueService.name);
  private readonly queue = new AsyncQueue<EmbeddingJob>('embedding', 5);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly contextVectors: ContextVectorService,
  ) {}

  onModuleInit(): void {
    this.queue.setHandler(async (job) => {
      await this.processJob(job.data);
    });
    this.queue.start();
    this.logger.log('Embedding queue started (max concurrency: 5)');
  }

  onModuleDestroy(): void {
    this.queue.stop();
    this.logger.log('Embedding queue stopped');
  }

  enqueue(job: EmbeddingJob): void {
    const jobId = ContextVectorService.generateId(job.accountId, job.uri);
    this.queue.enqueue(job, jobId);
  }

  getStats(): QueueStats {
    return this.queue.getStats();
  }

  private async processJob(job: EmbeddingJob): Promise<void> {
    this.logger.debug(`Embedding job: ${job.uri} (L${job.level})`);

    let embedding: number[] | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Truncate to ~6000 chars to stay within embedding model context limits
        const textToEmbed = job.text.length > 6000 ? job.text.slice(0, 6000) : job.text;
        embedding = await this.embeddingService.embed(textToEmbed);
        break;
      } catch (err) {
        this.logger.warn(
          `Embedding attempt ${attempt}/${MAX_RETRIES} failed for ${job.uri}: ${String(err)}`,
        );
        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS);
        }
      }
    }

    await this.contextVectors.upsert({
      uri: job.uri,
      parentUri: job.parentUri,
      contextType: job.contextType,
      level: job.level,
      abstract: job.abstract,
      name: job.name,
      accountId: job.accountId,
      ownerSpace: job.ownerSpace,
      embedding,
    });

    this.logger.debug(`Embedding job complete: ${job.uri} (vector=${embedding !== null})`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
