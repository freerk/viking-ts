import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmbeddingQueueService } from './embedding-queue.service';
import { SemanticQueueService } from './semantic-queue.service';
import { ApiResponse, ComponentStatus, SystemStatus } from '../shared/types';
import { QueueStats } from './async-queue';
import { okResponse } from '../shared/api-response.helper';
import { ContextVectorService } from '../storage/context-vector.service';
import { LlmService } from '../llm/llm.service';

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
    private readonly contextVector: ContextVectorService,
    private readonly llm: LlmService,
  ) {}

  @Get('queue')
  @ApiOperation({ summary: 'Get queue processing status (ComponentStatus)' })
  getQueue(): ApiResponse<ComponentStatus> {
    return okResponse(this.buildQueueStatus());
  }

  @Get('queues')
  @ApiOperation({ summary: 'Get queue processing status (alias)' })
  getQueues(): ApiResponse<ComponentStatus> {
    return okResponse(this.buildQueueStatus());
  }

  @Get('queues/raw')
  @ApiOperation({ summary: 'Get raw queue stats' })
  getQueuesRaw(): ApiResponse<QueueStatusResult> {
    return okResponse({
      semantic: this.semanticQueue.getStats(),
      embedding: this.embeddingQueue.getStats(),
    });
  }

  @Get('vikingdb')
  @ApiOperation({ summary: 'Get vector store status' })
  async getVikingdb(): Promise<ApiResponse<ComponentStatus>> {
    return okResponse(await this.buildVikingdbStatus());
  }

  @Get('vlm')
  @ApiOperation({ summary: 'Get LLM/VLM usage status' })
  getVlm(): ApiResponse<ComponentStatus> {
    return okResponse(this.buildVlmStatus());
  }

  @Get('system')
  @ApiOperation({ summary: 'Get aggregated system status' })
  async getSystem(): Promise<ApiResponse<SystemStatus>> {
    const queue = this.buildQueueStatus();
    const vikingdb = await this.buildVikingdbStatus();
    const vlm = this.buildVlmStatus();

    const errors: string[] = [];
    if (queue.has_errors) errors.push('queue: has processing errors');
    if (vikingdb.has_errors) errors.push('vikingdb: has errors');
    if (!vlm.is_healthy) errors.push('vlm: not configured');

    return okResponse({
      is_healthy: queue.is_healthy && vikingdb.is_healthy && vlm.is_healthy,
      errors,
      components: { queue, vikingdb, vlm },
    });
  }

  private buildQueueStatus(): ComponentStatus {
    const semantic = this.semanticQueue.getStats();
    const embedding = this.embeddingQueue.getStats();

    const semanticTotal = semantic.queued + semantic.active + semantic.processed + semantic.errors;
    const embeddingTotal = embedding.queued + embedding.active + embedding.processed + embedding.errors;
    const totalAll = semanticTotal + embeddingTotal;
    const totalErrors = semantic.errors + embedding.errors;
    const totalQueued = semantic.queued + embedding.queued;
    const totalActive = semantic.active + embedding.active;
    const totalProcessed = semantic.processed + embedding.processed;

    const status = [
      'Queue  Pending  In_Progress  Processed  Errors  Total',
      `Embedding  ${embedding.queued}  ${embedding.active}  ${embedding.processed}  ${embedding.errors}  ${embeddingTotal}`,
      `Semantic  ${semantic.queued}  ${semantic.active}  ${semantic.processed}  ${semantic.errors}  ${semanticTotal}`,
      `TOTAL  ${totalQueued}  ${totalActive}  ${totalProcessed}  ${totalErrors}  ${totalAll}`,
    ].join('\n');

    return {
      name: 'queue',
      is_healthy: totalErrors === 0,
      has_errors: totalErrors > 0,
      status,
    };
  }

  private async buildVikingdbStatus(): Promise<ComponentStatus> {
    let recordCount = 0;
    let hasErrors = false;
    let dbStatus = 'OK';

    try {
      recordCount = await this.contextVector.count();
    } catch {
      hasErrors = true;
      dbStatus = 'ERROR';
    }

    const status = [
      'Collection  Records  Status',
      `context  ${recordCount}  ${dbStatus}`,
      `TOTAL  ${recordCount}`,
    ].join('\n');

    return {
      name: 'vikingdb',
      is_healthy: !hasErrors,
      has_errors: hasErrors,
      status,
    };
  }

  private buildVlmStatus(): ComponentStatus {
    const isConfigured = this.llm.isConfigured();
    const usage = this.llm.getUsageStats();
    const provider = this.llm.getProviderName();
    const model = this.llm.getModelName();

    const totalTokens = usage.inputTokens + usage.outputTokens;

    const lines = ['Model  Provider  Calls  Input_Tokens  Output_Tokens  Total'];

    const byModel = usage.byModel;
    const keys = Object.keys(byModel);

    if (keys.length > 0) {
      for (const key of keys) {
        const stats = byModel[key];
        if (!stats) continue;
        const parts = key.split('/');
        const p = parts[0] ?? provider;
        const m = parts[1] ?? model;
        const t = stats.inputTokens + stats.outputTokens;
        lines.push(`${m}  ${p}  ${stats.calls}  ${stats.inputTokens}  ${stats.outputTokens}  ${t}`);
      }
    } else {
      lines.push(`${model}  ${provider}  0  0  0  0`);
    }

    lines.push(`TOTAL  ${usage.calls}  ${usage.inputTokens}  ${usage.outputTokens}  ${totalTokens}`);

    return {
      name: 'vlm',
      is_healthy: isConfigured,
      has_errors: false,
      status: lines.join('\n'),
    };
  }
}
