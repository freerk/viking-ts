import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { VfsService } from '../storage/vfs.service';
import { SemanticProcessorService } from '../queue/semantic-processor.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { okResponse, errorResponse } from '../shared/api-response.helper';
import { ApiResponse } from '../shared/types';
import { VikingError } from '../shared/errors';
import {
  ReadContentQueryDto,
  AbstractQueryDto,
  OverviewQueryDto,
  DownloadQueryDto,
  ReindexDto,
} from './content.dto';

@ApiTags('content')
@Controller('api/v1/content')
export class ContentController {
  constructor(
    private readonly vfs: VfsService,
    private readonly semanticProcessor: SemanticProcessorService,
    private readonly semanticQueue: SemanticQueueService,
    private readonly embeddingQueue: EmbeddingQueueService,
  ) {}

  @Get('read')
  @ApiOperation({ summary: 'Read file content' })
  async read(@Query() query: ReadContentQueryDto): Promise<ApiResponse<{ uri: string; content: string }>> {
    const startTime = Date.now();
    try {
      let content = await this.vfs.readFile(query.uri);

      if (query.offset !== undefined || query.limit !== undefined) {
        const lines = content.split('\n');
        const offset = query.offset ?? 0;
        const limit = query.limit ?? lines.length;
        content = lines.slice(offset, offset + limit).join('\n');
      }

      return okResponse({ uri: query.uri, content }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Get('abstract')
  @ApiOperation({ summary: 'Read L0 abstract for a directory' })
  async abstract(@Query() query: AbstractQueryDto): Promise<ApiResponse<{ uri: string; abstract: string }>> {
    const startTime = Date.now();
    try {
      const abs = await this.vfs.abstract(query.uri);
      return okResponse({ uri: query.uri, abstract: abs }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Get('overview')
  @ApiOperation({ summary: 'Read L1 overview for a directory' })
  async overview(@Query() query: OverviewQueryDto): Promise<ApiResponse<{ uri: string; overview: string }>> {
    const startTime = Date.now();
    try {
      const ov = await this.vfs.overview(query.uri);
      return okResponse({ uri: query.uri, overview: ov }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Get('download')
  @ApiOperation({ summary: 'Download raw file content' })
  async download(
    @Query() query: DownloadQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const content = await this.vfs.readFile(query.uri);
      const name = query.uri.split('/').pop() ?? 'download';
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(content);
    } catch (err) {
      if (err instanceof VikingError) {
        res.status(HttpStatus.NOT_FOUND).json(errorResponse(err.code, err.message));
        return;
      }
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'));
    }
  }

  @Post('reindex')
  @ApiOperation({ summary: 'Trigger reindex for a URI' })
  async reindex(@Body() dto: ReindexDto): Promise<ApiResponse<{ uri: string; regenerated: boolean }>> {
    const startTime = Date.now();
    try {
      const regenerate = dto.regenerate ?? false;
      const wait = dto.wait ?? false;

      const job = {
        uri: dto.uri,
        contextType: 'resource' as const,
        accountId: 'default',
        ownerSpace: '',
      };

      if (regenerate && wait) {
        await this.semanticProcessor.processDirectory(job);
      } else if (regenerate) {
        this.semanticQueue.enqueue(job);
      } else {
        const abs = await this.vfs.abstract(dto.uri);
        const overview = await this.vfs.overview(dto.uri);

        if (abs) {
          this.embeddingQueue.enqueue({
            uri: `${dto.uri}/.abstract.md`,
            text: abs,
            contextType: 'resource',
            level: 0,
            abstract: abs,
            name: '.abstract.md',
            parentUri: dto.uri,
            accountId: 'default',
            ownerSpace: '',
          });
        }
        if (overview) {
          this.embeddingQueue.enqueue({
            uri: `${dto.uri}/.overview.md`,
            text: overview,
            contextType: 'resource',
            level: 1,
            abstract: abs,
            name: '.overview.md',
            parentUri: dto.uri,
            accountId: 'default',
            ownerSpace: '',
          });
        }
      }

      return okResponse({ uri: dto.uri, regenerated: regenerate }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }
}

function toHttpException(err: unknown): HttpException {
  if (err instanceof VikingError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: HttpStatus.NOT_FOUND,
      CONFLICT: HttpStatus.CONFLICT,
      INVALID_URI: HttpStatus.BAD_REQUEST,
    };
    const status = statusMap[err.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    return new HttpException(
      errorResponse(err.code, err.message),
      status,
    );
  }
  if (err instanceof HttpException) {
    return err;
  }
  return new HttpException(
    errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'),
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
