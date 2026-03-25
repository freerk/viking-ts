import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VfsService } from '../storage/vfs.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { MemoryDeduplicatorService, DedupOutcome } from './memory-deduplicator.service';
import { CandidateMemory, MemoryCategory } from './session-extractor.service';
import { RequestContext } from '../shared/request-context';

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
  async writeAll(candidates: ReadonlyArray<CandidateMemory>, ctx: RequestContext): Promise<number> {
    let written = 0;
    const affectedDirs = new Set<string>();

    for (const candidate of candidates) {
      try {
        if (SINGLE_FILE_CATEGORIES.has(candidate.category)) {
          const dirUri = await this.writeProfileMemory(candidate, ctx);
          if (dirUri) {
            affectedDirs.add(dirUri);
            written++;
          }
        } else {
          const result = await this.writeWithDedup(candidate, ctx);
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
      this.enqueueSemanticProcessing(dirUri, ctx);
    }

    this.logger.log(`Wrote ${written}/${candidates.length} memories`);
    return written;
  }

  private async writeWithDedup(
    candidate: CandidateMemory,
    ctx: RequestContext,
  ): Promise<{ outcome: DedupOutcome; dirUri: string | null }> {
    const accountId = ctx.user.accountId;
    const ownerSpace = USER_CATEGORIES.has(candidate.category)
      ? ctx.user.userSpaceName()
      : ctx.user.agentSpaceName();

    const outcome = await this.deduplicator.deduplicate(candidate, accountId, ownerSpace);

    if (outcome === 'created') {
      const dirUri = await this.writeDirectoryFile(candidate, ctx);
      return { outcome, dirUri };
    }

    if (outcome === 'merged') {
      const spaceBase = USER_CATEGORIES.has(candidate.category)
        ? `viking://user/${ctx.user.userSpaceName()}`
        : `viking://agent/${ctx.user.agentSpaceName()}`;
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
  private async writeProfileMemory(candidate: CandidateMemory, ctx: RequestContext): Promise<string> {
    const spaceBase = USER_CATEGORIES.has(candidate.category)
      ? `viking://user/${ctx.user.userSpaceName()}`
      : `viking://agent/${ctx.user.agentSpaceName()}`;

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

    const ownerSpace = USER_CATEGORIES.has(candidate.category)
      ? ctx.user.userSpaceName()
      : ctx.user.agentSpaceName();

    this.enqueueEmbedding({
      uri,
      text: merged,
      abstract: candidate.abstract,
      name: 'profile.md',
      parentUri,
      ownerSpace,
      accountId: ctx.user.accountId,
      description: candidate.overview || undefined,
      tags: candidate.category,
    });

    this.logger.log(`Wrote profile memory: ${uri}`);
    return parentUri;
  }

  /**
   * For directory categories: create a new file per memory.
   */
  private async writeDirectoryFile(candidate: CandidateMemory, ctx: RequestContext): Promise<string> {
    const spaceBase = USER_CATEGORIES.has(candidate.category)
      ? `viking://user/${ctx.user.userSpaceName()}`
      : `viking://agent/${ctx.user.agentSpaceName()}`;

    const catPath = CATEGORY_PATH[candidate.category];
    const parentUri = `${spaceBase}/${catPath}`;
    const fileName = this.generateFileName(candidate);
    const uri = `${parentUri}/${fileName}`;

    const fileContent = this.buildFileContent(candidate);

    await this.vfs.writeFile(uri, fileContent);

    const ownerSpace = USER_CATEGORIES.has(candidate.category)
      ? ctx.user.userSpaceName()
      : ctx.user.agentSpaceName();

    this.enqueueEmbedding({
      uri,
      text: fileContent,
      abstract: candidate.abstract,
      name: fileName,
      parentUri,
      ownerSpace,
      accountId: ctx.user.accountId,
      description: candidate.overview || undefined,
      tags: candidate.category,
    });

    this.logger.log(`Wrote ${candidate.category} memory: ${uri}`);
    return parentUri;
  }

  /**
   * Generate a filename for the memory file.
   * Tools/skills use toolName/skillName if provided; others use abstract slug.
   */
  private generateFileName(candidate: CandidateMemory): string {
    const memoryId = `mem_${randomUUID().replace(/-/g, '')}`;

    if (candidate.category === 'tools' && candidate.toolName) {
      const slug = this.slugify(candidate.toolName);
      return slug ? `${slug}.md` : `${memoryId}.md`;
    }

    if (candidate.category === 'skills' && candidate.skillName) {
      const slug = this.slugify(candidate.skillName);
      return slug ? `${slug}.md` : `${memoryId}.md`;
    }

    const slug = this.slugify(candidate.abstract);
    return slug ? `${slug}-${memoryId.slice(0, 8)}.md` : `${memoryId}.md`;
  }

  /**
   * Build the file content, appending structured Markdown sections
   * for tools/skills extended fields when present.
   */
  private buildFileContent(candidate: CandidateMemory): string {
    const hasExtendedFields =
      (candidate.category === 'tools' || candidate.category === 'skills') &&
      (candidate.bestFor || candidate.optimalParams || candidate.recommendedFlow ||
       candidate.keyDependencies || candidate.commonFailures || candidate.recommendation);

    if (!hasExtendedFields) {
      return candidate.content;
    }

    const sections: string[] = [candidate.content];

    if (candidate.bestFor) {
      sections.push(`\n## Best For\n\n${candidate.bestFor}`);
    }
    if (candidate.optimalParams) {
      sections.push(`\n## Optimal Parameters\n\n${candidate.optimalParams}`);
    }
    if (candidate.recommendedFlow) {
      sections.push(`\n## Recommended Flow\n\n${candidate.recommendedFlow}`);
    }
    if (candidate.keyDependencies) {
      sections.push(`\n## Key Dependencies\n\n${candidate.keyDependencies}`);
    }
    if (candidate.commonFailures) {
      sections.push(`\n## Common Failures\n\n${candidate.commonFailures}`);
    }
    if (candidate.recommendation) {
      sections.push(`\n## Recommendation\n\n${candidate.recommendation}`);
    }

    return sections.join('\n');
  }

  private enqueueEmbedding(params: {
    uri: string;
    text: string;
    abstract: string;
    name: string;
    parentUri: string;
    ownerSpace: string;
    accountId: string;
    description?: string;
    tags?: string;
  }): void {
    this.embeddingQueue.enqueue({
      uri: params.uri,
      text: params.text,
      contextType: 'memory',
      level: 2,
      abstract: params.abstract,
      name: params.name,
      parentUri: params.parentUri,
      accountId: params.accountId,
      ownerSpace: params.ownerSpace,
      ...(params.description ? { description: params.description } : {}),
      ...(params.tags ? { tags: params.tags } : {}),
    });
  }

  private enqueueSemanticProcessing(dirUri: string, ctx: RequestContext): void {
    const ownerSpace = dirUri.startsWith('viking://user/')
      ? ctx.user.userSpaceName()
      : ctx.user.agentSpaceName();

    this.semanticQueue.enqueue({
      uri: dirUri,
      contextType: 'memory',
      accountId: ctx.user.accountId,
      ownerSpace,
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
