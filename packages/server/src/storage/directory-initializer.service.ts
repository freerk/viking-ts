import { Injectable, Logger, Optional } from '@nestjs/common';
import { VfsService } from './vfs.service';
import { ContextVectorService } from './context-vector.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService, EmbeddingJob } from '../queue/embedding-queue.service';
import { RequestContext } from '../shared/request-context';

interface DirectoryPreset {
  /** Full viking:// URI (may contain placeholders resolved at runtime) */
  uri: string;
  /** Parent URI, null for root-level directories */
  parentUri: string | null;
  /** L0 abstract text */
  abstract: string;
  /** L1 overview text */
  overview: string;
}

function agentPresets(agentSpace: string): DirectoryPreset[] {
  const base = `viking://agent/${agentSpace}`;
  return [
    {
      uri: `${base}/memories`,
      parentUri: base,
      abstract: "Agent's long-term memory storage. Contains cases and patterns, managed hierarchically by type.",
      overview: "Use this directory to access Agent's learning memories. Contains two main categories: 1) cases-specific cases, 2) patterns-reusable patterns.",
    },
    {
      uri: `${base}/memories/cases`,
      parentUri: `${base}/memories`,
      abstract: "Agent's case records. Stores specific problems and solutions, new problems and resolution processes encountered in each interaction.",
      overview: 'Access cases when encountering similar problems, reference historical solutions. Cases are records of specific conversations, each independent and not updated.',
    },
    {
      uri: `${base}/memories/patterns`,
      parentUri: `${base}/memories`,
      abstract: "Agent's effective patterns. Stores reusable processes and best practices distilled from multiple interactions, validated general solutions.",
      overview: 'Access patterns when executing tasks requiring strategy selection or process determination. Patterns are highly distilled experiences, each independent and not updated; create new pattern if modification needed.',
    },
    {
      uri: `${base}/instructions`,
      parentUri: base,
      abstract: "Agent instruction set. Contains Agent's behavioral directives, rules, and constraints.",
      overview: 'Access when Agent needs to follow specific rules. Examples: planner agent has specific planning process requirements, executor agent has execution standards, etc.',
    },
  ];
}

function userPresets(userId: string): DirectoryPreset[] {
  const base = `viking://user/${userId}`;
  return [
    {
      uri: `${base}/memories`,
      parentUri: base,
      abstract: "User's long-term memory storage. Contains memory types like preferences, entities, events, managed hierarchically by type.",
      overview: "Use this directory to access user's personalized memories. Contains three main categories: 1) preferences-user preferences, 2) entities-entity memories, 3) events-event records.",
    },
    {
      uri: `${base}/memories/preferences`,
      parentUri: `${base}/memories`,
      abstract: 'User\'s personalized preference memories. Stores preferences by topic (communication style, code standards, domain interests, etc.), one subdirectory per preference type, same-type preferences can be appended.',
      overview: 'Access when adjusting output style, following user habits, or providing personalized services. Examples: user prefers concise communication, code needs type annotations, focus on certain tech domains. Preferences organized by topic, same-type preferences aggregated in same subdirectory.',
    },
    {
      uri: `${base}/memories/entities`,
      parentUri: `${base}/memories`,
      abstract: "Entity memories from user's world. Each entity has its own subdirectory, including projects, people, concepts, etc. Entities are important objects in user's world, can append additional information.",
      overview: 'Access when referencing user-related projects, people, concepts. Examples: OpenViking project, colleague Zhang San, certain technical concept. Each entity stored independently, can append updates.',
    },
    {
      uri: `${base}/memories/events`,
      parentUri: `${base}/memories`,
      abstract: "User's event records. Each event has its own subdirectory, recording important events, decisions, milestones, etc. Events are time-independent, historical records not updated.",
      overview: 'Access when reviewing user history, understanding event context, or tracking user progress. Examples: decided to refactor memory system, completed a project, attended an event. Events are historical records, not updated once created.',
    },
  ];
}

const SKILLS_ROOT: DirectoryPreset = {
  uri: 'viking://agent/skills',
  parentUri: 'viking://agent',
  abstract: "Agent's skill registry. Uses Claude Skills protocol format, flat storage of callable skill definitions.",
  overview: 'Access when Agent needs to execute specific tasks. Skills categorized by tags, should retrieve relevant skills before executing tasks, select most appropriate skill to execute.',
};

@Injectable()
export class DirectoryInitializerService {
  private readonly logger = new Logger(DirectoryInitializerService.name);

  constructor(
    private readonly vfs: VfsService,
    private readonly contextVectors: ContextVectorService,
    private readonly embeddingService: EmbeddingService,
    @Optional() private readonly embeddingQueue?: EmbeddingQueueService,
  ) {}

  async initializeAgentSpace(ctx: RequestContext): Promise<void> {
    const agentSpace = ctx.user.agentSpaceName();
    const presets = agentPresets(agentSpace);
    for (const preset of presets) {
      await this.ensureDirectory(
        preset.uri,
        preset.parentUri,
        preset.abstract,
        preset.overview,
        agentSpace,
        ctx.user.accountId,
      );
    }
    this.logger.debug(`Agent space initialized: ${agentSpace}`);
  }

  async initializeUserSpace(ctx: RequestContext): Promise<void> {
    const userSpace = ctx.user.userSpaceName();
    const presets = userPresets(userSpace);
    for (const preset of presets) {
      await this.ensureDirectory(
        preset.uri,
        preset.parentUri,
        preset.abstract,
        preset.overview,
        userSpace,
        ctx.user.accountId,
      );
    }
    this.logger.debug(`User space initialized: ${userSpace}`);
  }

  async initializeSkillsRoot(): Promise<void> {
    await this.ensureDirectory(
      SKILLS_ROOT.uri,
      SKILLS_ROOT.parentUri,
      SKILLS_ROOT.abstract,
      SKILLS_ROOT.overview,
      'default',
      'default',
    );
    this.logger.debug('Skills root initialized');
  }

  private async ensureDirectory(
    uri: string,
    parentUri: string | null,
    abstract: string,
    overview: string,
    ownerSpace: string,
    accountId: string,
  ): Promise<void> {
    const exists = await this.vfs.exists(uri);
    if (!exists) {
      await this.vfs.mkdir(uri);
    }

    await this.seedVector(uri, parentUri, abstract, 0, ownerSpace, accountId);
    await this.seedVector(uri, parentUri, overview, 1, ownerSpace, accountId);
  }

  private async seedVector(
    uri: string,
    parentUri: string | null,
    text: string,
    level: 0 | 1,
    ownerSpace: string,
    accountId: string,
  ): Promise<void> {
    const name = uri.split('/').filter(Boolean).pop() ?? '';

    if (this.embeddingQueue) {
      const job: EmbeddingJob = {
        uri,
        text,
        contextType: 'resource',
        level,
        abstract: level === 0 ? text : '',
        name,
        parentUri,
        accountId,
        ownerSpace,
      };
      this.embeddingQueue.enqueue(job);
      return;
    }

    const embedding = await this.embeddingService.embed(text);
    await this.contextVectors.upsert({
      uri,
      parentUri,
      contextType: 'resource',
      level,
      abstract: level === 0 ? text : '',
      name,
      accountId,
      ownerSpace,
      embedding,
    });
  }
}
