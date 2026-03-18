import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MemoryService } from './memory.service';
import { CreateMemoryDto, SearchMemoriesQueryDto, ListMemoriesQueryDto } from './memory.dto';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, MemoryRecord, SearchResult } from '../shared/types';
import { MemoryType, MemoryCategory } from '../shared/types';

@ApiTags('memories')
@Controller('api/v1/memories')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post()
  @ApiOperation({ summary: 'Store a new memory' })
  async create(@Body() dto: CreateMemoryDto): Promise<ApiResponse<MemoryRecord>> {
    const startTime = Date.now();
    const memory = await this.memoryService.createMemory({
      text: dto.text,
      type: dto.type as MemoryType | undefined,
      category: dto.category as MemoryCategory | undefined,
      agentId: dto.agentId,
      userId: dto.userId,
      uri: dto.uri,
    });
    return okResponse(memory, startTime);
  }

  @Get('search')
  @ApiOperation({ summary: 'Semantic search over memories' })
  async search(@Query() query: SearchMemoriesQueryDto): Promise<ApiResponse<SearchResult[]>> {
    const startTime = Date.now();
    const results = await this.memoryService.searchMemories(
      query.q,
      query.limit ?? 6,
      query.scoreThreshold ?? 0.01,
      query.uri,
    );
    return okResponse(results, startTime);
  }

  @Get()
  @ApiOperation({ summary: 'List memories with optional filters' })
  list(@Query() query: ListMemoriesQueryDto): ApiResponse<MemoryRecord[]> {
    const startTime = Date.now();
    const memories = this.memoryService.listMemories({
      agentId: query.agentId,
      userId: query.userId,
      type: query.type as MemoryType | undefined,
      category: query.category as MemoryCategory | undefined,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
    });
    return okResponse(memories, startTime);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific memory' })
  get(@Param('id') id: string): ApiResponse<MemoryRecord> {
    const startTime = Date.now();
    const memory = this.memoryService.getMemory(id);
    return okResponse(memory, startTime);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a memory' })
  async delete(@Param('id') id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    const startTime = Date.now();
    await this.memoryService.deleteMemory(id);
    return okResponse({ deleted: true }, startTime);
  }
}
