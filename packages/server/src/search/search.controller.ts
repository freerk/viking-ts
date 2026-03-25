import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import {
  FindRequestDto,
  SearchRequestDto,
  GrepRequestDto,
  GlobRequestDto,
  FindResult,
  GrepMatch,
} from './search.dto';
import { okResponse, errorResponse } from '../shared/api-response.helper';
import { ApiResponse } from '../shared/types';
import { VikingError } from '../shared/errors';

@ApiTags('search')
@Controller('api/v1/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('find')
  @ApiOperation({ summary: 'Hierarchical semantic search (find)' })
  async find(
    @Body() dto: FindRequestDto,
  ): Promise<ApiResponse<FindResult>> {
    const startTime = Date.now();
    try {
      const result = await this.searchService.find({
        query: dto.query,
        targetDirectories: dto.target_uri ? [dto.target_uri] : undefined,
        limit: dto.node_limit ?? dto.limit ?? 10,
        scoreThreshold: dto.score_threshold,
      });
      return okResponse(result, startTime);
    } catch (err) {
      throw toHttpException(err, startTime);
    }
  }

  @Post('search')
  @ApiOperation({ summary: 'Hierarchical semantic search with session context' })
  async search(
    @Body() dto: SearchRequestDto,
  ): Promise<ApiResponse<FindResult>> {
    const startTime = Date.now();
    try {
      const result = await this.searchService.search({
        query: dto.query,
        targetUri: dto.target_uri,
        sessionId: dto.session_id,
        limit: dto.node_limit ?? dto.limit ?? 10,
        scoreThreshold: dto.score_threshold,
        filter: dto.filter,
      });
      return okResponse(result, startTime);
    } catch (err) {
      throw toHttpException(err, startTime);
    }
  }

  @Post('grep')
  @ApiOperation({ summary: 'Regex grep over VFS file content' })
  async grep(
    @Body() dto: GrepRequestDto,
  ): Promise<ApiResponse<{ matches: GrepMatch[] }>> {
    const startTime = Date.now();
    try {
      const matches = await this.searchService.grep(
        dto.uri,
        dto.pattern,
        dto.case_insensitive ?? false,
        dto.node_limit,
      );
      return okResponse({ matches }, startTime);
    } catch (err) {
      throw toHttpException(err, startTime);
    }
  }

  @Post('glob')
  @ApiOperation({ summary: 'Glob pattern match over VFS URIs' })
  async glob(
    @Body() dto: GlobRequestDto,
  ): Promise<ApiResponse<{ matches: string[] }>> {
    const startTime = Date.now();
    try {
      const matches = await this.searchService.glob(
        dto.pattern,
        dto.uri,
        dto.node_limit,
      );
      return okResponse({ matches }, startTime);
    } catch (err) {
      throw toHttpException(err, startTime);
    }
  }
}

function toHttpException(err: unknown, startTime: number): HttpException {
  if (err instanceof HttpException) return err;

  if (err instanceof VikingError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: HttpStatus.NOT_FOUND,
      CONFLICT: HttpStatus.CONFLICT,
      INVALID_URI: HttpStatus.BAD_REQUEST,
    };
    const status = statusMap[err.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    return new HttpException(errorResponse(err.code, err.message, startTime), status);
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  return new HttpException(
    errorResponse('INTERNAL_ERROR', message, startTime),
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
