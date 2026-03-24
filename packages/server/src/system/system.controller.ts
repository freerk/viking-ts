import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../storage/database.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { okResponse, errorResponse } from '../shared/api-response.helper';
import { RequestContext } from '../shared/request-context';
import { VikingContext } from '../shared/request-context.interceptor';

interface ReadyCheck {
  db: 'ok' | 'error';
  embedding: 'ok' | 'error';
}

@ApiTags('system')
@Controller()
export class SystemController {
  constructor(
    private readonly db: DatabaseService,
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingQueue: EmbeddingQueueService,
    private readonly semanticQueue: SemanticQueueService,
  ) {}

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe with subsystem checks' })
  ready() {
    const checks: ReadyCheck = { db: 'error', embedding: 'error' };

    try {
      this.db.db.prepare('SELECT 1').get();
      checks.db = 'ok';
    } catch {
      // db not accessible
    }

    try {
      const dim = this.embeddingService.getDimension();
      if (dim > 0) {
        checks.embedding = 'ok';
      }
    } catch {
      // embedding not configured
    }

    const allOk = checks.db === 'ok' && checks.embedding === 'ok';
    if (!allOk) {
      throw new HttpException(
        errorResponse('NOT_READY', 'One or more subsystems not ready'),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return okResponse({ status: 'ready', checks });
  }

  @Get('api/v1/system/status')
  @ApiOperation({ summary: 'System status' })
  getStatus(@VikingContext() ctx: RequestContext) {
    return okResponse({
      initialized: true,
      version: '0.1.0',
      user: ctx.user.userId,
      agent: ctx.user.agentId,
    });
  }

  @Post('api/v1/system/wait')
  @HttpCode(200)
  @ApiOperation({ summary: 'Wait for queue drain' })
  async wait(@Body() body: { timeout?: number }) {
    const timeout = body.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const pollInterval = 200;

    while (Date.now() < deadline) {
      const embeddingStats = this.embeddingQueue.getStats();
      const semanticStats = this.semanticQueue.getStats();

      const idle =
        embeddingStats.queued === 0 &&
        embeddingStats.active === 0 &&
        semanticStats.queued === 0 &&
        semanticStats.active === 0;

      if (idle) {
        return okResponse({ drained: true });
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return okResponse({ drained: false, reason: 'timeout' });
  }
}
