import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { VfsService, TreeNode } from '../storage/vfs.service';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, VikingNode } from '../shared/types';

@ApiTags('viking-uri')
@Controller('api/v1')
export class VikingUriController {
  constructor(private readonly vfs: VfsService) {}

  @Get('ls')
  @ApiOperation({ summary: 'List contents at a Viking URI' })
  @ApiQuery({ name: 'uri', required: true })
  async ls(@Query('uri') uri: string): Promise<ApiResponse<{ uri: string; children: string[] }>> {
    const startTime = Date.now();

    if (!uri) {
      throw new BadRequestException('uri query parameter is required');
    }

    const entries = await this.vfs.ls(uri);
    const children = entries.map((e) => e.uri);

    return okResponse({ uri, children }, startTime);
  }

  @Get('tree')
  @ApiOperation({ summary: 'Tree view of a Viking URI' })
  @ApiQuery({ name: 'uri', required: true })
  @ApiQuery({ name: 'depth', required: false })
  async tree(
    @Query('uri') uri: string,
    @Query('depth') depthStr?: string,
  ): Promise<ApiResponse<VikingNode>> {
    const startTime = Date.now();

    if (!uri) {
      throw new BadRequestException('uri query parameter is required');
    }

    const depth = depthStr ? parseInt(depthStr, 10) : 2;
    const treeResult = await this.vfs.tree(uri, { levelLimit: depth });

    const vikingNode = treeNodeToVikingNode(treeResult);
    return okResponse(vikingNode, startTime);
  }
}

function treeNodeToVikingNode(node: TreeNode): VikingNode {
  const result: VikingNode = {
    uri: node.uri,
    name: node.name,
    type: node.isDir ? 'directory' : 'file',
  };

  if (node.children) {
    result.children = node.children.map((c) => treeNodeToVikingNode(c));
  }

  return result;
}
