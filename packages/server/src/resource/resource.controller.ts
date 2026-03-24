import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags, ApiConsumes } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { randomUUID } from 'crypto';
import { ResourceService } from './resource.service';
import { AddResourceDto, CreateResourceDto, SearchResourcesQueryDto } from './resource.dto';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, ResourceRecord, SearchResult } from '../shared/types';
import { VfsService } from '../storage/vfs.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';

interface AddSkillBody {
  data?: unknown;
  temp_path?: string;
  wait?: boolean;
  timeout?: number;
}

@ApiTags('resources')
@Controller('api/v1')
export class ResourceController {
  private readonly tmpDir: string;

  constructor(
    private readonly resourceService: ResourceService,
    private readonly config: ConfigService,
    private readonly vfs: VfsService,
    private readonly embeddingQueue: EmbeddingQueueService,
    private readonly semanticQueue: SemanticQueueService,
  ) {
    const storagePath = this.config.get<string>('storage.path', '~/.viking-ts/data');
    this.tmpDir = join(storagePath, '..', 'tmp');
    if (!existsSync(this.tmpDir)) {
      mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  @Post('resources/temp_upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a temporary file for add_resource' })
  async tempUpload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResponse<{ temp_path: string }>> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    this.cleanupTempFiles();

    const ext = file.originalname
      ? '.' + file.originalname.split('.').pop()
      : '.tmp';
    const tempFilename = `upload_${randomUUID().replace(/-/g, '')}${ext}`;
    const tempPath = join(this.tmpDir, tempFilename);

    writeFileSync(tempPath, file.buffer);

    return okResponse({ temp_path: tempPath });
  }

  @Post('resources')
  @ApiOperation({ summary: 'Add resource to Viking (OpenViking-compatible)' })
  async addResource(
    @Body() body: AddResourceDto,
  ): Promise<ApiResponse<unknown>> {
    const isLegacy = !body.path && !body.to && !body.parent && body.text && (body.title || body.uri);

    if (isLegacy) {
      const result = await this.resourceService.addResource({
        text: body.text,
        to: body.uri,
        title: body.title,
      });
      return okResponse({
        status: result.status,
        root_uri: result.root_uri,
        source_path: result.source_path,
        errors: result.errors,
      });
    }

    if (!body.path && !body.text) {
      throw new BadRequestException("Either 'path' or 'text' must be provided");
    }

    const result = await this.resourceService.addResource({
      path: body.path,
      text: body.text,
      to: body.to,
      parent: body.parent,
      reason: body.reason,
      instruction: body.instruction,
      wait: body.wait,
      title: body.title,
      uri: body.uri,
    });

    return okResponse({
      status: result.status,
      root_uri: result.root_uri,
      source_path: result.source_path,
      errors: result.errors,
    });
  }

  @Post('skills')
  @ApiOperation({ summary: 'Add skill to Viking (OpenViking-compatible)' })
  async addSkill(
    @Body() body: AddSkillBody,
  ): Promise<ApiResponse<unknown>> {
    let content: string;
    let skillName: string;

    if (body.temp_path) {
      try {
        const { readFileSync: readFs } = await import('fs');
        content = readFs(body.temp_path, 'utf-8');
        skillName = body.temp_path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'skill';
      } catch {
        throw new BadRequestException(`Cannot read file: ${body.temp_path}`);
      }
    } else if (body.data !== undefined && body.data !== null) {
      content = typeof body.data === 'string'
        ? body.data
        : JSON.stringify(body.data, null, 2);
      skillName = 'skill';
    } else {
      throw new BadRequestException("Either 'data' or 'temp_path' must be provided");
    }

    const targetUri = `viking://agent/skills/${skillName}/`;

    await this.vfs.writeFile(targetUri, content);

    const parentUri = 'viking://agent/skills';
    const abstract = content.slice(0, 256);

    this.embeddingQueue.enqueue({
      uri: targetUri,
      text: content,
      contextType: 'skill',
      level: 2,
      abstract,
      name: `${skillName}.md`,
      parentUri,
      accountId: 'default',
      ownerSpace: 'default',
    });

    this.semanticQueue.enqueue({
      uri: parentUri,
      contextType: 'skill',
      accountId: 'default',
      ownerSpace: 'default',
    });

    return okResponse({
      uri: targetUri,
      status: body.wait ? 'ok' : 'accepted',
    });
  }

  /* Legacy endpoints (kept for backward compatibility) */

  @Post('resources/legacy')
  @ApiOperation({ summary: 'Add a new resource (legacy)' })
  async createLegacy(@Body() dto: CreateResourceDto): Promise<ApiResponse<ResourceRecord>> {
    const startTime = Date.now();
    const resource = await this.resourceService.createResource({
      title: dto.title,
      text: dto.text,
      url: dto.url,
      uri: dto.uri,
    });
    return okResponse(resource, startTime);
  }

  @Get('resources/search')
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

  @Get('resources')
  @ApiOperation({ summary: 'List all resources' })
  async list(): Promise<ApiResponse<ResourceRecord[]>> {
    const startTime = Date.now();
    const resources = await this.resourceService.listResources();
    return okResponse(resources, startTime);
  }

  @Get('resources/:id')
  @ApiOperation({ summary: 'Get a specific resource' })
  async get(@Param('id') id: string): Promise<ApiResponse<ResourceRecord>> {
    const startTime = Date.now();
    const resource = await this.resourceService.getResource(id);
    return okResponse(resource, startTime);
  }

  @Delete('resources/:id')
  @ApiOperation({ summary: 'Delete a resource' })
  async deleteResource(@Param('id') id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    const startTime = Date.now();
    await this.resourceService.deleteResource(id);
    return okResponse({ deleted: true }, startTime);
  }

  private cleanupTempFiles(): void {
    try {
      if (!existsSync(this.tmpDir)) return;

      const now = Date.now();
      const maxAgeMs = 3600 * 1000;

      for (const file of readdirSync(this.tmpDir)) {
        const filePath = join(this.tmpDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
            unlinkSync(filePath);
          }
        } catch {
          // ignore per-file errors
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
