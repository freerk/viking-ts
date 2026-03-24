import { Injectable, Logger, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, relative, basename, extname } from 'path';
import { v4 as uuid } from 'uuid';
import { VfsService } from '../storage/vfs.service';
import { ContextVectorService } from '../storage/context-vector.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { LlmService } from '../llm/llm.service';
import { ResourceRecord, SearchResult } from '../shared/types';
import {
  parsePdf,
  parseDocx,
  parseXlsx,
  parsePptx,
  parseHtml,
  parseImage,
  parseAudio,
  stripHtmlTags,
} from './parsers';
import { TranscriptionConfig } from './parsers/audio';

const WALKABLE_EXTENSIONS = new Set([
  // Text
  '.md', '.txt', '.ts', '.js', '.mjs', '.cjs', '.py', '.go', '.java', '.rs', '.rb', '.php', '.cs', '.cpp', '.c', '.h',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
  // Documents
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.pptx', '.ppt',
  // Web
  '.html', '.htm',
  // Images (only processed if VLM multimodal configured)
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  // Audio (only processed if transcription configured)
  '.mp3', '.wav', '.m4a', '.ogg',
]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);

interface AddResourceParams {
  path?: string;
  text?: string;
  to?: string;
  parent?: string;
  reason?: string;
  instruction?: string;
  wait?: boolean;
  title?: string;
  uri?: string;
}

interface AddResourceResult {
  status: 'success' | 'error';
  root_uri: string;
  source_path: string | null;
  errors: string[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9./-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function walkDirectory(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDirectory(full));
    } else {
      const ext = '.' + entry.split('.').pop();
      if (WALKABLE_EXTENSIONS.has(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);
  private readonly transcriptionConfig: TranscriptionConfig;

  constructor(
    private readonly vfs: VfsService,
    private readonly contextVectors: ContextVectorService,
    private readonly embeddingService: EmbeddingService,
    private readonly configService: ConfigService,
    @Optional() private readonly llmService?: LlmService,
    @Optional() private readonly embeddingQueue?: EmbeddingQueueService,
    @Optional() private readonly semanticQueue?: SemanticQueueService,
  ) {
    this.transcriptionConfig = {
      provider: this.configService.get<string>('transcription.provider', 'openai'),
      apiKey: this.configService.get<string>('transcription.apiKey', ''),
      apiBase: this.configService.get<string>('transcription.apiBase', 'https://api.openai.com/v1'),
      model: this.configService.get<string>('transcription.model', 'whisper-1'),
    };
  }

  async addResource(params: AddResourceParams): Promise<AddResourceResult> {
    if (params.to && params.parent) {
      throw new BadRequestException("Cannot specify both 'to' and 'parent'");
    }

    const targetScope = params.to ?? params.parent;
    if (targetScope && !targetScope.startsWith('viking://resources')) {
      throw new BadRequestException('Target URI must be in viking://resources/ scope');
    }

    if (params.path && isUrl(params.path)) {
      return this.ingestUrl(params);
    }

    if (params.path) {
      const resolvedPath = params.path;
      if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
        return this.ingestDirectory(params, resolvedPath);
      }
      return this.ingestFile(params, resolvedPath);
    }

    return this.ingestText(params);
  }

  private resolveRootUri(params: AddResourceParams, fallbackName: string): string {
    if (params.to) return params.to;
    if (params.uri) return params.uri;
    if (params.parent) return `${params.parent.replace(/\/$/, '')}/${slugify(fallbackName)}`;
    return `viking://resources/${slugify(fallbackName)}`;
  }

  private async storeUnit(
    uri: string,
    content: string,
    name: string,
    reason?: string,
  ): Promise<void> {
    await this.vfs.writeFile(uri, content);

    const l0Abstract = (reason && reason.length <= 256) ? reason : content.slice(0, 256);
    const parentUri = uri.substring(0, uri.lastIndexOf('/')) || 'viking://resources';

    if (this.embeddingQueue) {
      this.embeddingQueue.enqueue({
        uri,
        text: content,
        contextType: 'resource',
        level: 2,
        abstract: l0Abstract,
        name,
        parentUri,
        accountId: 'default',
        ownerSpace: '',
      });
    } else {
      let embedding: number[] | null = null;
      try {
        embedding = await this.embeddingService.embed(l0Abstract || content);
      } catch (err) {
        this.logger.warn(`Embedding failed for ${uri}: ${String(err)}`);
      }
      await this.contextVectors.upsert({
        uri,
        parentUri,
        contextType: 'resource',
        level: 2,
        abstract: l0Abstract,
        name,
        accountId: 'default',
        embedding,
      });
    }

    if (this.semanticQueue) {
      this.semanticQueue.enqueue({
        uri: parentUri,
        contextType: 'resource',
        accountId: 'default',
        ownerSpace: '',
      });
    }
  }

  private async ingestText(params: AddResourceParams): Promise<AddResourceResult> {
    const content = params.text ?? '';
    if (!content) {
      throw new BadRequestException("Either 'path' or 'text' must be provided");
    }

    const fallbackName = params.title ?? `resource-${uuid().slice(0, 8)}.md`;
    const rootUri = this.resolveRootUri(params, fallbackName);

    await this.storeUnit(rootUri, content, params.title ?? basename(rootUri), params.reason);

    return {
      status: 'success',
      root_uri: rootUri,
      source_path: null,
      errors: [],
    };
  }

  private async ingestFile(params: AddResourceParams, filePath: string): Promise<AddResourceResult> {
    const ext = extname(filePath).toLowerCase();
    let content: string;

    try {
      content = await this.parseFile(filePath, ext);
    } catch (err) {
      return {
        status: 'error',
        root_uri: '',
        source_path: filePath,
        errors: [`Parse error: ${String(err)}`],
      };
    }

    if (!content.trim()) {
      return {
        status: 'error',
        root_uri: '',
        source_path: filePath,
        errors: [`No content extracted from ${basename(filePath)}`],
      };
    }

    const fileName = basename(filePath);
    const rootUri = this.resolveRootUri(params, fileName);

    await this.storeUnit(rootUri, content, fileName, params.reason);

    return {
      status: 'success',
      root_uri: rootUri,
      source_path: filePath,
      errors: [],
    };
  }

  private async parseFile(filePath: string, ext: string): Promise<string> {
    switch (ext) {
      case '.pdf':
        return parsePdf(filePath);
      case '.docx':
      case '.doc':
        return parseDocx(filePath);
      case '.xlsx':
      case '.xls':
      case '.csv':
        return parseXlsx(filePath);
      case '.pptx':
      case '.ppt':
        return parsePptx(filePath);
      case '.html':
      case '.htm':
        return parseHtml(filePath);
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.gif':
      case '.webp':
        if (!this.llmService) {
          return '[Image parsing requires VLM service]';
        }
        return parseImage(filePath, this.llmService);
      case '.mp3':
      case '.wav':
      case '.m4a':
      case '.ogg':
        return parseAudio(filePath, this.transcriptionConfig);
      default:
        return readFileSync(filePath, 'utf-8');
    }
  }

  private async ingestDirectory(params: AddResourceParams, dirPath: string): Promise<AddResourceResult> {
    const dirName = basename(dirPath);
    const rootUri = this.resolveRootUri(params, dirName);
    const errors: string[] = [];

    const files = walkDirectory(dirPath);
    for (const file of files) {
      const relPath = relative(dirPath, file);
      const fileUri = `${rootUri.replace(/\/$/, '')}/${relPath}`;
      const ext = extname(file).toLowerCase();
      try {
        const content = await this.parseFile(file, ext);
        if (!content.trim()) {
          errors.push(`${relPath}: No content extracted`);
          continue;
        }
        await this.storeUnit(fileUri, content, basename(file), params.reason);
      } catch (err) {
        errors.push(`${relPath}: ${String(err)}`);
      }
    }

    return {
      status: 'success',
      root_uri: rootUri,
      source_path: dirPath,
      errors,
    };
  }

  private async ingestUrl(params: AddResourceParams): Promise<AddResourceResult> {
    const url = params.path!;
    let content: string;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();

      if (contentType.includes('text/html')) {
        content = stripHtmlTags(body);
      } else {
        content = body;
      }
    } catch (err) {
      throw new BadRequestException(`Cannot fetch URL: ${url} (${String(err)})`);
    }

    const urlPath = new URL(url).pathname;
    const fileName = basename(urlPath) || 'index.md';
    const rootUri = this.resolveRootUri(params, fileName);

    await this.storeUnit(rootUri, content, fileName, params.reason);

    return {
      status: 'success',
      root_uri: rootUri,
      source_path: url,
      errors: [],
    };
  }

  async createResource(params: {
    title?: string;
    text?: string;
    url?: string;
    uri?: string;
  }): Promise<ResourceRecord> {
    if (!params.text && !params.url) {
      throw new BadRequestException('Either text or url must be provided');
    }

    const id = uuid();
    const now = new Date().toISOString();
    const content = params.text ?? `Resource from URL: ${params.url}`;
    const title = params.title ?? params.url ?? content.slice(0, 80);
    const uri = params.uri ?? `viking://resources/${id}.md`;
    const parentUri = 'viking://resources';

    await this.vfs.writeFile(uri, content);

    const l0Abstract = content.slice(0, 256);
    const cvId = ContextVectorService.generateId('default', uri);

    if (this.embeddingQueue) {
      this.embeddingQueue.enqueue({
        uri,
        text: content,
        contextType: 'resource',
        level: 2,
        abstract: l0Abstract,
        name: title,
        parentUri,
        accountId: 'default',
        ownerSpace: '',
      });
    } else {
      let embedding: number[] | null = null;
      try {
        embedding = await this.embeddingService.embed(l0Abstract || content);
      } catch (err) {
        this.logger.warn(`Embedding failed for resource ${id}: ${String(err)}`);
      }
      await this.contextVectors.upsert({
        uri,
        parentUri,
        contextType: 'resource',
        level: 2,
        abstract: l0Abstract,
        name: title,
        accountId: 'default',
        embedding,
      });
    }

    if (this.semanticQueue) {
      this.semanticQueue.enqueue({
        uri: parentUri,
        contextType: 'resource',
        accountId: 'default',
        ownerSpace: '',
      });
    }

    const resource: ResourceRecord = {
      id: cvId,
      title,
      uri,
      sourceUrl: params.url,
      l0Abstract,
      l1Overview: '',
      l2Content: content,
      createdAt: now,
      updatedAt: now,
    };

    this.logger.log(`Created resource ${cvId}: "${title}"`);
    return resource;
  }

  async searchResources(
    query: string,
    limit: number = 10,
    scoreThreshold: number = 0.01,
  ): Promise<SearchResult[]> {
    const vector = await this.embeddingService.embed(query);
    const results = await this.contextVectors.searchSimilar(vector, {
      limit,
      scoreThreshold,
      contextType: 'resource',
    });

    return results.map((r) => ({
      id: r.id,
      uri: r.uri,
      text: r.abstract || r.description,
      score: r.score,
      l0Abstract: r.abstract,
    }));
  }

  async getResource(id: string): Promise<ResourceRecord> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'resource') {
      throw new NotFoundException(`Resource ${id} not found`);
    }

    let content = '';
    try {
      content = await this.vfs.readFile(record.uri);
    } catch {
      content = record.description;
    }

    return {
      id: record.id,
      title: record.name,
      uri: record.uri,
      l0Abstract: record.abstract,
      l1Overview: record.description,
      l2Content: content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async listResources(limit: number = 100, offset: number = 0): Promise<ResourceRecord[]> {
    const records = await this.contextVectors.listByContextType('resource', {
      limit,
      offset,
    });

    const resources: ResourceRecord[] = [];
    for (const record of records) {
      let content = '';
      try {
        content = await this.vfs.readFile(record.uri);
      } catch {
        content = record.description;
      }
      resources.push({
        id: record.id,
        title: record.name,
        uri: record.uri,
        l0Abstract: record.abstract,
        l1Overview: record.description,
        l2Content: content,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    return resources;
  }

  async deleteResource(id: string): Promise<void> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'resource') {
      throw new NotFoundException(`Resource ${id} not found`);
    }

    try {
      await this.vfs.rm(record.uri);
    } catch {
      // file may not exist
    }

    await this.contextVectors.deleteById(id);
    this.logger.log(`Deleted resource ${id}`);
  }
}
