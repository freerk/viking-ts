import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VfsService } from '../storage/vfs.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { MemoryDeduplicatorService, DedupOutcome } from './memory-deduplicator.service';
import { CandidateMemory, MemoryCategory } from './session-extractor.service';

/** Category to VFS path mapping, matching OpenViking memory_extractor.py. */
const CATEGORY_PATH: Record<MemoryCategory, string> = {
  profile: 'memories/profile.md',
  preferences: 'memories/preferences',
  entities: 'memories/entities',
  events: 'memories/events',
  cases: 'memories/cases',
  patterns: 'memories/patterns',
  tools: 'memories/tools',
  skills: 'memories/skills',
};

/** Categories that live under the user space. */
const USER_CATEGORIES = new Set<MemoryCategory>([
  'profile',
  'preferences',
  'entities',
  'events',
]);

/** Profile is a single file that gets content appended (merged). */
const SINGLE_FILE_CATEGORIES = new Set<MemoryCategory>(['profile']);

@Injectable()
export class SessionMemoryWriterService {
  private readonly logger = new Logger(SessionMemoryWriterService.name);

  constructor(
    private readonly vfs: VfsService,
    private readonly embeddingQueue: EmbeddingQueueService,
    private readonly semanticQueue: SemanticQueueService,
    private readonly deduplicator: MemoryDeduplicatorService,
  ) {}

  /**
   * Write all candidate memories to VFS and enqueue for processing.
   * Profile memories bypass dedup (always merge). All other categories
   * go through MemoryDeduplicatorService first.
   * Returns the number of memories successfully written or merged.
   */
  async writeAll(candidates: ReadonlyArray<CandidateMemory>): Promise<number> {
    let written = 0;
    const affectedDirs = new Set<string>();

    for (const candidate of candidates) {
      try {
        if (SINGLE_FILE_CATEGORIES.has(candidate.category)) {
          const dirUri = await this.writeProfileMemory(candidate);
          if (dirUri) {
            affectedDirs.add(dirUri);
            written++;
          }
        } else {
          const result = await this.writeWithDedup(candidate);
          if (result.dirUri) {
            affectedDirs.add(result.dirUri);
          }
          if (result.outcome !== 'skipped') {
            written++;
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed to write memory (${candidate.category}): ${String(err)}`,
        );
      }
    }

    for (const dirUri of affectedDirs) {
      this.enqueueSemanticProcessing(dirUri);
    }

    this.logger.log(`Wrote ${written}/${candidates.length} memories`);
    return written;
  }

  private async writeWithDedup(
    candidate: CandidateMemory,
  ): Promise<{ outcome: DedupOutcome; dirUri: string | null }> {
    const accountId = 'default';
    const ownerSpace = 'default';

    const outcome = await this.deduplicator.deduplicate(candidate, accountId, ownerSpace);

    if (outcome === 'created') {
      const dirUri = await this.writeDirectoryFile(candidate);
      return { outcome, dirUri };
    }

    if (outcome === 'merged') {
      const spaceBase = USER_CATEGORIES.has(candidate.category)
        ? 'viking://user/default'
        : 'viking://agent/default';
      const catPath = CATEGORY_PATH[candidate.category];
      const dirUri = `${spaceBase}/${catPath}`;
      return { outcome, dirUri };
    }

    this.logger.debug(`Skipped duplicate memory: "${candidate.abstract}"`);
    return { outcome, dirUri: null };
  }

  /**
   * For single-file categories (profile): read existing content and append.
   * Bypasses dedup entirely (always merge).
   */
  private async writeProfileMemory(candidate: CandidateMemory): Promise<string> {
    const spaceBase = USER_CATEGORIES.has(candidate.category)
      ? 'viking://user/default'
      : 'viking://agent/default';

    const catPath = CATEGORY_PATH[candidate.category];
    const uri = `${spaceBase}/${catPath}`;
    const parentUri = uri.substring(0, uri.lastIndexOf('/'));

    let existing = '';
    try {
      existing = await this.vfs.readFile(uri);
    } catch {
      // file does not exist yet
    }

    const merged = existing
      ? `${existing}\n\n---\n\n${candidate.content}`
      : candidate.content;

    await this.vfs.writeFile(uri, merged);

    this.enqueueEmbedding({
      uri,
      text: merged,
      abstract: candidate.abstract,
      name: 'profile.md',
      parentUri,
      ownerSpace: 'default',
    });

    this.logger.log(`Wrote profile memory: ${uri}`);
    return parentUri;
  }

  /**
   * For directory categories: create a new file per memory.
   */
  private async writeDirectoryFile(candidate: CandidateMemory): Promise<string> {
    const spaceBase = USER_CATEGORIES.has(candidate.category)
      ? 'viking://user/default'
      : 'viking://agent/default';

    const catPath = CATEGORY_PATH[candidate.category];
    const parentUri = `${spaceBase}/${catPath}`;
    const slug = this.slugify(candidate.abstract);
    const memoryId = `mem_${randomUUID().replace(/-/g, '')}`;
    const fileName = slug ? `${slug}-${memoryId.slice(0, 8)}.md` : `${memoryId}.md`;
    const uri = `${parentUri}/${fileName}`;

    await this.vfs.writeFile(uri, candidate.content);

    this.enqueueEmbedding({
      uri,
      text: candidate.content,
      abstract: candidate.abstract,
      name: fileName,
      parentUri,
      ownerSpace: 'default',
    });

    this.logger.log(`Wrote ${candidate.category} memory: ${uri}`);
    return parentUri;
  }

  private enqueueEmbedding(params: {
    uri: string;
    text: string;
    abstract: string;
    name: string;
    parentUri: string;
    ownerSpace: string;
  }): void {
    this.embeddingQueue.enqueue({
      uri: params.uri,
      text: params.text,
      contextType: 'memory',
      level: 2,
      abstract: params.abstract,
      name: params.name,
      parentUri: params.parentUri,
      accountId: 'default',
      ownerSpace: params.ownerSpace,
    });
  }

  private enqueueSemanticProcessing(dirUri: string): void {
    this.semanticQueue.enqueue({
      uri: dirUri,
      contextType: 'memory',
      accountId: 'default',
      ownerSpace: 'default',
    });
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
}
