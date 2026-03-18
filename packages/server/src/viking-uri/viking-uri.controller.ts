import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { VikingUriService } from './viking-uri.service';
import { MetadataStoreService } from '../storage/metadata-store.service';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, VikingNode } from '../shared/types';

@ApiTags('viking-uri')
@Controller('api/v1')
export class VikingUriController {
  constructor(
    private readonly vikingUri: VikingUriService,
    private readonly metadataStore: MetadataStoreService,
  ) {}

  @Get('ls')
  @ApiOperation({ summary: 'List contents at a Viking URI' })
  @ApiQuery({ name: 'uri', required: true })
  ls(@Query('uri') uri: string): ApiResponse<{ uri: string; children: string[] }> {
    const startTime = Date.now();

    if (!uri) {
      throw new BadRequestException('uri query parameter is required');
    }

    const parsed = this.vikingUri.parse(uri);
    const prefix = `viking://${parsed.fullPath}`;

    const allUris: string[] = [];

    if (parsed.scope === 'resources' || parsed.scope === 'user' || parsed.scope === 'agent') {
      if (parsed.scope === 'resources') {
        const resources = this.metadataStore.listResources(1000);
        allUris.push(...resources.map((r) => r.uri));
      } else {
        const memories = this.metadataStore.listMemories({
          type: parsed.scope === 'user' ? 'user' : 'agent',
          limit: 1000,
        });
        allUris.push(...memories.map((m) => m.uri));
      }
    }

    const children = allUris.filter((u) => u.startsWith(prefix) && u !== uri);

    return okResponse({ uri, children }, startTime);
  }

  @Get('tree')
  @ApiOperation({ summary: 'Tree view of a Viking URI' })
  @ApiQuery({ name: 'uri', required: true })
  @ApiQuery({ name: 'depth', required: false })
  tree(
    @Query('uri') uri: string,
    @Query('depth') depthStr?: string,
  ): ApiResponse<VikingNode> {
    const startTime = Date.now();

    if (!uri) {
      throw new BadRequestException('uri query parameter is required');
    }

    const depth = depthStr ? parseInt(depthStr, 10) : 2;
    const parsed = this.vikingUri.parse(uri);
    const prefix = `viking://${parsed.fullPath}`;

    const allUris: string[] = [];

    if (parsed.scope === 'resources') {
      const resources = this.metadataStore.listResources(1000);
      allUris.push(...resources.map((r) => r.uri));
    } else {
      const memories = this.metadataStore.listMemories({
        type: parsed.scope === 'user' ? 'user' : 'agent',
        limit: 1000,
      });
      allUris.push(...memories.map((m) => m.uri));
    }

    const filtered = allUris.filter((u) => u.startsWith(prefix));
    const tree = this.vikingUri.buildTree(filtered, uri, depth);

    return okResponse(tree, startTime);
  }
}
