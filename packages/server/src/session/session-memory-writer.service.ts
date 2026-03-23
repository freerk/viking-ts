import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VfsService } from '../storage/vfs.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
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
  ) {}

  /**
   * Write all candidate memories to VFS and enqueue for processing.
   * Returns the number of memories successfully written.
   */
  async writeAll(candidates: ReadonlyArray<CandidateMemory>): Promise<number> {
    let written = 0;
    const affectedDirs = new Set<string>();

    for (const candidate of candidates) {
      try {
        const dirUri = await this.writeCandidate(candidate);
        if (dirUri) {
          affectedDirs.add(dirUri);
          written++;
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

  private async writeCandidate(candidate: CandidateMemory): Promise<string | null> {
    const spaceBase = USER_CATEGORIES.has(candidate.category)
      ? 'viking://user/default'
      : 'viking://agent/default';

    const catPath = CATEGORY_PATH[candidate.category];
    const isSingleFile = SINGLE_FILE_CATEGORIES.has(candidate.category);

    if (isSingleFile) {
      return this.writeSingleFile(spaceBase, catPath, candidate);
    }

    return this.writeDirectoryFile(spaceBase, catPath, candidate);
  }

  /**
   * For single-file categories (profile): read existing content and append.
   */
  private async writeSingleFile(
    spaceBase: string,
    catPath: string,
    candidate: CandidateMemory,
  ): Promise<string> {
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
  private async writeDirectoryFile(
    spaceBase: string,
    catPath: string,
    candidate: CandidateMemory,
  ): Promise<string> {
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
