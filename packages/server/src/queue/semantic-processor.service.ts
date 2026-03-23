import { Injectable, Logger } from '@nestjs/common';
import { VfsService } from '../storage/vfs.service';
import { LlmService } from '../llm/llm.service';
import { EmbeddingQueueService } from './embedding-queue.service';
import { chunkText } from './text-utils';

export interface SemanticJob {
  uri: string;
  contextType: 'memory' | 'resource' | 'skill';
  accountId: string;
  ownerSpace: string;
  changes?: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

const MAX_OVERVIEW_CHARS = 4000;
const MAX_ABSTRACT_CHARS = 256;
const MEMORY_CHUNK_SIZE = 2000;
const MEMORY_CHUNK_OVERLAP = 200;
const LLM_CONCURRENCY = 5;

@Injectable()
export class SemanticProcessorService {
  private readonly logger = new Logger(SemanticProcessorService.name);

  constructor(
    private readonly vfs: VfsService,
    private readonly llm: LlmService,
    private readonly embeddingQueue: EmbeddingQueueService,
  ) {}

  async processDirectory(job: SemanticJob): Promise<void> {
    if (job.contextType === 'memory') {
      await this.processMemoryDirectory(job);
      return;
    }

    this.logger.log(`Processing directory: ${job.uri} (${job.contextType})`);

    const entries = await this.vfs.ls(job.uri, { showAllHidden: false });
    const files = entries.filter(
      (e) =>
        !e.isDir &&
        !e.name.endsWith('.abstract.md') &&
        !e.name.endsWith('.overview.md'),
    );
    const subdirs = entries.filter((e) => e.isDir);

    const fileSummaries = await this.summarizeFilesWithConcurrency(files, LLM_CONCURRENCY);

    const childAbstracts: Array<{ name: string; abstract: string }> = [];
    for (const subdir of subdirs) {
      const abs = await this.vfs.abstract(subdir.uri);
      if (abs) {
        childAbstracts.push({ name: subdir.name, abstract: abs });
      }
    }

    const dirName = job.uri.split('/').pop() ?? job.uri;
    let overview = await this.llm.generateDirectoryOverview(
      dirName,
      fileSummaries,
      childAbstracts,
    );

    if (overview.length > MAX_OVERVIEW_CHARS) {
      overview = overview.slice(0, MAX_OVERVIEW_CHARS);
    }

    const abstract = this.llm.extractAbstractFromOverview(overview).slice(0, MAX_ABSTRACT_CHARS);

    await this.writeAndEnqueue(job, overview, abstract);
  }

  async processMemoryDirectory(job: SemanticJob): Promise<void> {
    this.logger.log(`Processing memory directory: ${job.uri}`);

    const entries = await this.vfs.ls(job.uri, { showAllHidden: false });
    const files = entries.filter(
      (e) =>
        !e.isDir &&
        !e.name.startsWith('.') &&
        !e.name.endsWith('.abstract.md') &&
        !e.name.endsWith('.overview.md'),
    );

    const fileSummaries: Array<{ name: string; summary: string }> = [];

    for (const file of files) {
      let content: string;
      try {
        content = await this.vfs.readFile(file.uri);
      } catch {
        continue;
      }

      this.embeddingQueue.enqueue({
        uri: file.uri,
        text: content,
        contextType: 'memory',
        level: 2,
        abstract: content.slice(0, MAX_ABSTRACT_CHARS),
        name: file.name,
        parentUri: job.uri,
        accountId: job.accountId,
        ownerSpace: job.ownerSpace,
      });

      if (content.length > MEMORY_CHUNK_SIZE) {
        const chunks = chunkText(content, MEMORY_CHUNK_SIZE, MEMORY_CHUNK_OVERLAP);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (!chunk) continue;
          const chunkUri = `${file.uri}#chunk_${String(i).padStart(4, '0')}`;
          this.embeddingQueue.enqueue({
            uri: chunkUri,
            text: chunk,
            contextType: 'memory',
            level: 2,
            abstract: chunk.slice(0, MAX_ABSTRACT_CHARS),
            name: `${file.name}#chunk_${String(i).padStart(4, '0')}`,
            parentUri: file.uri,
            accountId: job.accountId,
            ownerSpace: job.ownerSpace,
          });
        }
      }

      fileSummaries.push({ name: file.name, summary: content.slice(0, 500) });
    }

    const subdirs = entries.filter((e) => e.isDir);
    const childAbstracts: Array<{ name: string; abstract: string }> = [];
    for (const subdir of subdirs) {
      const abs = await this.vfs.abstract(subdir.uri);
      if (abs) {
        childAbstracts.push({ name: subdir.name, abstract: abs });
      }
    }

    if (fileSummaries.length === 0 && childAbstracts.length === 0) {
      this.logger.debug(`No content in memory directory: ${job.uri}`);
      return;
    }

    const dirName = job.uri.split('/').pop() ?? job.uri;
    let overview = await this.llm.generateDirectoryOverview(
      dirName,
      fileSummaries,
      childAbstracts,
    );

    if (overview.length > MAX_OVERVIEW_CHARS) {
      overview = overview.slice(0, MAX_OVERVIEW_CHARS);
    }

    const abstract = this.llm.extractAbstractFromOverview(overview).slice(0, MAX_ABSTRACT_CHARS);

    await this.writeAndEnqueue(job, overview, abstract);
  }

  private async writeAndEnqueue(
    job: SemanticJob,
    overview: string,
    abstract: string,
  ): Promise<void> {
    const abstractUri = `${job.uri}/.abstract.md`;
    const overviewUri = `${job.uri}/.overview.md`;

    await this.vfs.writeFile(abstractUri, abstract);
    await this.vfs.writeFile(overviewUri, overview);

    this.embeddingQueue.enqueue({
      uri: abstractUri,
      text: abstract,
      contextType: job.contextType,
      level: 0,
      abstract,
      name: '.abstract.md',
      parentUri: job.uri,
      accountId: job.accountId,
      ownerSpace: job.ownerSpace,
    });

    this.embeddingQueue.enqueue({
      uri: overviewUri,
      text: overview,
      contextType: job.contextType,
      level: 1,
      abstract,
      name: '.overview.md',
      parentUri: job.uri,
      accountId: job.accountId,
      ownerSpace: job.ownerSpace,
    });

    this.logger.log(`L0/L1 written for ${job.uri}`);
  }

  private async summarizeFilesWithConcurrency(
    files: ReadonlyArray<{ uri: string; name: string }>,
    concurrency: number,
  ): Promise<Array<{ name: string; summary: string }>> {
    const results: Array<{ name: string; summary: string }> = [];
    const pending = [...files];

    const worker = async (): Promise<void> => {
      while (pending.length > 0) {
        const file = pending.shift();
        if (!file) break;

        try {
          const content = await this.vfs.readFile(file.uri);
          const summary = await this.llm.summarizeFile(file.name, content);
          results.push({ name: file.name, summary });
        } catch (err) {
          this.logger.warn(`Failed to summarize ${file.uri}: ${String(err)}`);
          results.push({ name: file.name, summary: '(summary unavailable)' });
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(concurrency, files.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    return results;
  }
}
