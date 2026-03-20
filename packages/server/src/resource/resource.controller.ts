import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResourceService } from './resource.service';
import { CreateResourceDto, SearchResourcesQueryDto } from './resource.dto';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, ResourceRecord, SearchResult } from '../shared/types';

@ApiTags('resources')
@Controller('api/v1/resources')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Post()
  @ApiOperation({ summary: 'Add a new resource' })
  async create(@Body() dto: CreateResourceDto): Promise<ApiResponse<ResourceRecord>> {
    const startTime = Date.now();
    const resource = await this.resourceService.createResource({
      title: dto.title,
      text: dto.text,
      url: dto.url,
      uri: dto.uri,
    });
    return okResponse(resource, startTime);
  }

  @Get('search')
  @ApiOperation({ summary: 'Semantic search over resources' })
  async search(@Query() query: SearchResourcesQueryDto): Promise<ApiResponse<SearchResult[]>> {
    const startTime = Date.now();
    const results = await this.resourceService.searchResources(
      query.q,
      query.limit ?? 10,
      query.scoreThreshold ?? 0.01,
    );
    return okResponse(results, startTime);
  }

  @Get()
  @ApiOperation({ summary: 'List all resources' })
  list(): ApiResponse<ResourceRecord[]> {
    const startTime = Date.now();
    const resources = this.resourceService.listResources();
    return okResponse(resources, startTime);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific resource' })
  get(@Param('id') id: string): ApiResponse<ResourceRecord> {
    const startTime = Date.now();
    const resource = this.resourceService.getResource(id);
    return okResponse(resource, startTime);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a resource' })
  async delete(@Param('id') id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    const startTime = Date.now();
    await this.resourceService.deleteResource(id);
    return okResponse({ deleted: true }, startTime);
  }
}
