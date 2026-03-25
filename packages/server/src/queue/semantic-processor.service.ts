import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VfsService } from '../storage/vfs.service';
import { LlmService } from '../llm/llm.service';
import { EmbeddingQueueService } from './embedding-queue.service';
import { ContextVectorService } from '../storage/context-vector.service';
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

const LLM_CONCURRENCY = 5;

@Injectable()
export class SemanticProcessorService {
  private readonly logger = new Logger(SemanticProcessorService.name);

  constructor(
    private readonly vfs: VfsService,
    private readonly llm: LlmService,
    private readonly embeddingQueue: EmbeddingQueueService,
    private readonly config: ConfigService,
    private readonly contextVectors: ContextVectorService,
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

    const maxOverviewPromptChars = this.config.get<number>('semantic.maxOverviewPromptChars', 60000);
    const overviewBatchSize = this.config.get<number>('semantic.overviewBatchSize', 50);
    const maxOverviewChars = this.config.get<number>('semantic.overviewMaxChars', 4000);
    const abstractMaxChars = this.config.get<number>('semantic.abstractMaxChars', 256);

    let overview = await this.generateOverviewWithBudget(
      job.uri,
      fileSummaries,
      childAbstracts,
      maxOverviewPromptChars,
      overviewBatchSize,
    );

    if (overview.length > maxOverviewChars) {
      overview = overview.slice(0, maxOverviewChars);
    }

    const abstract = this.llm.extractAbstractFromOverview(overview).slice(0, abstractMaxChars);

    await this.writeAndEnqueue(job, overview, abstract);
  }

  async processMemoryDirectory(job: SemanticJob): Promise<void> {
    this.logger.log(`Processing memory directory: ${job.uri}`);

    const abstractMaxChars = this.config.get<number>('semantic.abstractMaxChars', 256);
    const memoryChunkChars = this.config.get<number>('semantic.memoryChunkChars', 2000);
    const memoryChunkOverlap = this.config.get<number>('semantic.memoryChunkOverlap', 200);
    const maxOverviewChars = this.config.get<number>('semantic.overviewMaxChars', 4000);

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

      const existing = await this.contextVectors.getByUri(file.uri).catch(() => undefined);

      if (!existing) {
        this.embeddingQueue.enqueue({
          uri: file.uri,
          text: content,
          contextType: 'memory',
          level: 2,
          abstract: content.slice(0, abstractMaxChars),
          name: file.name,
          parentUri: job.uri,
          accountId: job.accountId,
          ownerSpace: job.ownerSpace,
        });
      }

      if (content.length > memoryChunkChars) {
        const chunks = chunkText(content, memoryChunkChars, memoryChunkOverlap);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (!chunk) continue;
          const chunkUri = `${file.uri}#chunk_${String(i).padStart(4, '0')}`;
          const existingChunk = await this.contextVectors.getByUri(chunkUri).catch(() => undefined);
          if (!existingChunk) {
            this.embeddingQueue.enqueue({
              uri: chunkUri,
              text: chunk,
              contextType: 'memory',
              level: 2,
              abstract: chunk.slice(0, abstractMaxChars),
              name: `${file.name}#chunk_${String(i).padStart(4, '0')}`,
              parentUri: file.uri,
              accountId: job.accountId,
              ownerSpace: job.ownerSpace,
            });
          }
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

    const maxOverviewPromptChars = this.config.get<number>('semantic.maxOverviewPromptChars', 60000);
    const overviewBatchSize = this.config.get<number>('semantic.overviewBatchSize', 50);

    let overview = await this.generateOverviewWithBudget(
      job.uri,
      fileSummaries,
      childAbstracts,
      maxOverviewPromptChars,
      overviewBatchSize,
    );

    if (overview.length > maxOverviewChars) {
      overview = overview.slice(0, maxOverviewChars);
    }

    const abstract = this.llm.extractAbstractFromOverview(overview).slice(0, abstractMaxChars);

    await this.writeAndEnqueue(job, overview, abstract);
  }

  /**
   * Budget guard: decide between single, truncated, or batched overview generation
   * based on estimated prompt size and file count.
   * Ports OpenViking semantic_processor.py _generate_overview().
   */
  private async generateOverviewWithBudget(
    dirUri: string,
    fileSummaries: ReadonlyArray<{ name: string; summary: string }>,
    childAbstracts: ReadonlyArray<{ name: string; abstract: string }>,
    maxOverviewPromptChars: number,
    overviewBatchSize: number,
  ): Promise<string> {
    const fileSummariesStr = fileSummaries
      .map((f, i) => `[${i + 1}] ${f.name}: ${f.summary}`)
      .join('\n');
    const childAbstractsStr = childAbstracts
      .map((c) => `- ${c.name}/: ${c.abstract}`)
      .join('\n') || 'None';

    const estimatedSize = fileSummariesStr.length + childAbstractsStr.length;
    const overBudget = estimatedSize > maxOverviewPromptChars;
    const manyFiles = fileSummaries.length > overviewBatchSize;

    if (overBudget && manyFiles) {
      return this.batchedGenerateOverview(dirUri, fileSummaries, childAbstracts, overviewBatchSize);
    }

    if (overBudget) {
      const perFile = Math.max(100, Math.floor(maxOverviewPromptChars / Math.max(fileSummaries.length, 1)));
      const truncated = fileSummaries.map((f) => ({
        name: f.name,
        summary: f.summary.slice(0, perFile),
      }));
      return this.singleGenerateOverview(dirUri, truncated, childAbstracts);
    }

    return this.singleGenerateOverview(dirUri, fileSummaries, childAbstracts);
  }

  /**
   * Single-pass overview generation with file index map post-processing.
   */
  private async singleGenerateOverview(
    dirUri: string,
    fileSummaries: ReadonlyArray<{ name: string; summary: string }>,
    childAbstracts: ReadonlyArray<{ name: string; abstract: string }>,
  ): Promise<string> {
    const dirName = dirUri.split('/').pop() ?? dirUri;
    const raw = await this.llm.generateDirectoryOverview(
      dirName,
      [...fileSummaries],
      [...childAbstracts],
    );
    return this.replaceFileIndexes(raw, fileSummaries);
  }

  /**
   * Batched overview generation: split fileSummaries into groups of batchSize,
   * generate a partial overview per batch, then merge all partial overviews.
   * Ports OpenViking semantic_processor.py _batched_generate_overview().
   */
  private async batchedGenerateOverview(
    dirUri: string,
    fileSummaries: ReadonlyArray<{ name: string; summary: string }>,
    childAbstracts: ReadonlyArray<{ name: string; abstract: string }>,
    batchSize: number,
  ): Promise<string> {
    const dirName = dirUri.split('/').pop() ?? dirUri;
    const partialOverviews: string[] = [];

    for (let i = 0; i < fileSummaries.length; i += batchSize) {
      const batch = fileSummaries.slice(i, i + batchSize);
      const partial = await this.llm.generateDirectoryOverview(
        dirName,
        [...batch],
        i === 0 ? [...childAbstracts] : [],
      );
      partialOverviews.push(this.replaceFileIndexes(partial, batch));
    }

    const mergedSummaries = partialOverviews.map((p, i) => ({
      name: `batch_${i + 1}`,
      summary: p,
    }));

    const finalOverview = await this.llm.generateDirectoryOverview(
      dirName,
      mergedSummaries,
      [...childAbstracts],
    );

    return finalOverview;
  }

  /**
   * Replace `[N]` index references in overview text with actual filenames.
   */
  private replaceFileIndexes(
    text: string,
    fileSummaries: ReadonlyArray<{ name: string; summary: string }>,
  ): string {
    let result = text;
    for (let i = 0; i < fileSummaries.length; i++) {
      const file = fileSummaries[i];
      if (!file) continue;
      result = result.replaceAll(`[${i + 1}]`, file.name);
    }
    return result;
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

    // Back-propagate L0/L1 into the parent vector record so that list/search
    // responses return populated l0Abstract and l1Overview fields.
    this.contextVectors.updateAbstractAndDescription(job.uri, abstract, overview).catch(() => {});

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
