import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Like, Repository } from 'typeorm';
import { VfsNodeEntity } from './entities';
import { InvalidUriError, NotFoundError, ConflictError } from '../shared/errors';

export interface VfsEntry {
  uri: string;
  parentUri: string | null;
  name: string;
  isDir: boolean;
  size: number;
  createdAt: string;
  updatedAt: string;
  content?: string | null;
  abstract?: string;
}

export interface LsOptions {
  simple?: boolean;
  recursive?: boolean;
  output?: 'original' | 'agent';
  absLimit?: number;
  showAllHidden?: boolean;
  nodeLimit?: number;
}

export interface TreeNode {
  uri: string;
  name: string;
  isDir: boolean;
  size: number;
  abstract?: string;
  children?: TreeNode[];
}

export interface TreeOptions extends LsOptions {
  levelLimit?: number;
}

const VIKING_URI_REGEX = /^viking:\/\//;

@Injectable()
export class VfsService {

  constructor(
    @InjectRepository(VfsNodeEntity)
    private readonly repo: Repository<VfsNodeEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private validateUri(uri: string): void {
    if (!VIKING_URI_REGEX.test(uri)) {
      throw new InvalidUriError(uri);
    }
  }

  normalizeUri(uri: string): string {
    this.validateUri(uri);
    if (uri === 'viking://') return uri;
    return uri.replace(/\/+$/, '');
  }

  parentUri(uri: string): string | null {
    const normalized = this.normalizeUri(uri);
    if (normalized === 'viking://') return null;

    const lastSlash = normalized.lastIndexOf('/');
    const prefix = normalized.slice(0, lastSlash);

    if (prefix === 'viking:/') return 'viking://';
    return prefix;
  }

  private entityToEntry(entity: VfsNodeEntity): VfsEntry {
    return {
      uri: entity.uri,
      parentUri: entity.parentUri,
      name: entity.name,
      isDir: entity.isDir === 1,
      size: entity.size,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      content: entity.content,
    };
  }

  async stat(uri: string): Promise<VfsEntry> {
    const normalized = this.normalizeUri(uri);
    const entity = await this.repo.findOneBy({ uri: normalized });

    if (!entity) {
      throw new NotFoundError(normalized);
    }

    return this.entityToEntry(entity);
  }

  async exists(uri: string): Promise<boolean> {
    const normalized = this.normalizeUri(uri);
    return this.repo.existsBy({ uri: normalized });
  }

  async mkdir(uri: string): Promise<VfsEntry> {
    const normalized = this.normalizeUri(uri);
    const now = new Date().toISOString();

    if (await this.exists(normalized)) {
      const existing = await this.stat(normalized);
      if (existing.isDir) return existing;
      throw new ConflictError(`File exists at URI: ${normalized}`);
    }

    const parent = this.parentUri(normalized);
    if (parent && parent !== 'viking://' && !(await this.exists(parent))) {
      await this.mkdir(parent);
    }

    const name = normalized.split('/').pop() ?? '';

    await this.repo.insert({
      uri: normalized,
      parentUri: parent,
      name,
      isDir: 1,
      size: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      uri: normalized,
      parentUri: parent,
      name,
      isDir: true,
      size: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async writeFile(uri: string, content: string): Promise<VfsEntry> {
    const normalized = this.normalizeUri(uri);
    const now = new Date().toISOString();
    const name = normalized.split('/').pop() ?? '';
    const parent = this.parentUri(normalized);
    const size = Buffer.byteLength(content, 'utf-8');

    if (parent && parent !== 'viking://' && !(await this.exists(parent))) {
      await this.mkdir(parent);
    }

    await this.repo
      .createQueryBuilder()
      .insert()
      .values({
        uri: normalized,
        parentUri: parent,
        name,
        isDir: 0,
        content,
        size,
        createdAt: now,
        updatedAt: now,
      })
      .orUpdate(['content', 'size', 'updated_at'], ['uri'])
      .execute();

    return {
      uri: normalized,
      parentUri: parent,
      name,
      isDir: false,
      size,
      createdAt: now,
      updatedAt: now,
      content,
    };
  }

  async readFile(uri: string): Promise<string> {
    const normalized = this.normalizeUri(uri);
    const entity = await this.repo.findOne({
      where: { uri: normalized, isDir: 0 },
      select: ['content'],
    });

    if (!entity) {
      throw new NotFoundError(normalized);
    }

    return entity.content ?? '';
  }

  async rm(uri: string, recursive: boolean = false): Promise<void> {
    const normalized = this.normalizeUri(uri);

    if (!(await this.exists(normalized))) {
      throw new NotFoundError(normalized);
    }

    if (recursive) {
      await this.repo
        .createQueryBuilder()
        .delete()
        .where('uri = :uri OR uri LIKE :pattern', {
          uri: normalized,
          pattern: `${normalized}/%`,
        })
        .execute();
    } else {
      const hasChildren = await this.repo.existsBy({ parentUri: normalized });

      if (hasChildren) {
        throw new ConflictError(`Directory not empty: ${normalized}`);
      }

      await this.repo.delete({ uri: normalized });
    }
  }

  async mv(fromUri: string, toUri: string): Promise<void> {
    const fromNorm = this.normalizeUri(fromUri);
    const toNorm = this.normalizeUri(toUri);

    if (!(await this.exists(fromNorm))) {
      throw new NotFoundError(fromNorm);
    }

    if (await this.exists(toNorm)) {
      throw new ConflictError(`Target already exists: ${toNorm}`);
    }

    const toParent = this.parentUri(toNorm);
    if (toParent && toParent !== 'viking://' && !(await this.exists(toParent))) {
      await this.mkdir(toParent);
    }

    const toName = toNorm.split('/').pop() ?? '';

    await this.dataSource.transaction(async (manager) => {
      const vfsRepo = manager.getRepository(VfsNodeEntity);

      await vfsRepo
        .createQueryBuilder()
        .update()
        .set({ uri: toNorm, parentUri: toParent, name: toName, updatedAt: new Date().toISOString() })
        .where('uri = :uri', { uri: fromNorm })
        .execute();

      const children = await vfsRepo
        .createQueryBuilder()
        .select('uri')
        .where('uri LIKE :pattern', { pattern: `${fromNorm}/%` })
        .getRawMany<{ uri: string }>();

      for (const child of children) {
        const newChildUri = toNorm + child.uri.slice(fromNorm.length);
        const newChildParent = this.parentUri(newChildUri) ?? toNorm;
        await vfsRepo
          .createQueryBuilder()
          .update()
          .set({ uri: newChildUri, parentUri: newChildParent, updatedAt: new Date().toISOString() })
          .where('uri = :uri', { uri: child.uri })
          .execute();
      }
    });
  }

  async ls(uri: string, options: LsOptions = {}): Promise<VfsEntry[]> {
    const normalized = uri === 'viking://' ? 'viking://' : this.normalizeUri(uri);
    const { recursive = false, showAllHidden = false, nodeLimit } = options;

    let entities: VfsNodeEntity[];

    if (recursive) {
      const pattern = normalized === 'viking://' ? 'viking://%' : `${normalized}/%`;
      entities = await this.repo.find({
        where: { uri: Like(pattern) },
        order: { uri: 'ASC' },
      });
    } else {
      entities = await this.repo.find({
        where: { parentUri: normalized },
        order: { uri: 'ASC' },
      });
    }

    let entries = entities.map((e) => this.entityToEntry(e));

    if (!showAllHidden) {
      entries = entries.filter(
        (e) => !e.name.startsWith('.abstract') && !e.name.startsWith('.overview'),
      );
    }

    if (options.output === 'agent') {
      const absLimit = options.absLimit ?? 256;
      for (const entry of entries) {
        if (entry.isDir) {
          entry.abstract = await this.abstract(entry.uri);
          if (entry.abstract && entry.abstract.length > absLimit) {
            entry.abstract = entry.abstract.slice(0, absLimit);
          }
        }
      }
    }

    if (nodeLimit !== undefined && nodeLimit > 0) {
      entries = entries.slice(0, nodeLimit);
    }

    return entries;
  }

  async tree(uri: string, options: TreeOptions = {}): Promise<TreeNode> {
    const normalized = uri === 'viking://' ? 'viking://' : this.normalizeUri(uri);
    const { levelLimit = 3, showAllHidden = false, output, absLimit = 256, nodeLimit } = options;

    let entry: VfsEntry | undefined;
    try {
      entry = await this.stat(normalized);
    } catch {
      // root might not exist as a node
    }

    const rootName = normalized.split('/').filter(Boolean).pop() ?? 'viking://';

    const root: TreeNode = {
      uri: normalized,
      name: rootName,
      isDir: entry?.isDir ?? true,
      size: entry?.size ?? 0,
    };

    if (output === 'agent') {
      root.abstract = await this.abstract(normalized);
      if (root.abstract && root.abstract.length > absLimit) {
        root.abstract = root.abstract.slice(0, absLimit);
      }
    }

    if (levelLimit > 0) {
      root.children = await this.buildTreeChildren(normalized, 1, levelLimit, showAllHidden, output, absLimit, nodeLimit);
    }

    return root;
  }

  private async buildTreeChildren(
    parentUri: string,
    currentLevel: number,
    levelLimit: number,
    showAllHidden: boolean,
    output: string | undefined,
    absLimit: number,
    nodeLimit: number | undefined,
  ): Promise<TreeNode[]> {
    let children = await this.ls(parentUri, {
      simple: true,
      showAllHidden,
      nodeLimit,
    });

    if (nodeLimit !== undefined && nodeLimit > 0) {
      children = children.slice(0, nodeLimit);
    }

    const nodes: TreeNode[] = [];

    for (const child of children) {
      const node: TreeNode = {
        uri: child.uri,
        name: child.name,
        isDir: child.isDir,
        size: child.size,
      };

      if (output === 'agent' && child.isDir) {
        node.abstract = await this.abstract(child.uri);
        if (node.abstract && node.abstract.length > absLimit) {
          node.abstract = node.abstract.slice(0, absLimit);
        }
      }

      if (child.isDir && currentLevel < levelLimit) {
        node.children = await this.buildTreeChildren(
          child.uri,
          currentLevel + 1,
          levelLimit,
          showAllHidden,
          output,
          absLimit,
          nodeLimit,
        );
      }

      nodes.push(node);
    }

    return nodes;
  }

  async abstract(uri: string): Promise<string> {
    const normalized = this.normalizeUri(uri);
    const abstractUri = `${normalized}/.abstract.md`;
    try {
      return await this.readFile(abstractUri);
    } catch {
      return '';
    }
  }

  async overview(uri: string): Promise<string> {
    const normalized = this.normalizeUri(uri);
    const overviewUri = `${normalized}/.overview.md`;
    try {
      return await this.readFile(overviewUri);
    } catch {
      return '';
    }
  }

  async grep(uri: string, pattern: string, caseInsensitive: boolean = false, nodeLimit?: number): Promise<Array<{ uri: string; matches: string[] }>> {
    const normalized = this.normalizeUri(uri);
    const dbPattern = normalized === 'viking://' ? 'viking://%' : `${normalized}/%`;

    const rows = await this.repo
      .createQueryBuilder('node')
      .select(['node.uri', 'node.content'])
      .where('node.isDir = 0 AND node.uri LIKE :pattern AND node.content IS NOT NULL', {
        pattern: dbPattern,
      })
      .getMany();

    const flags = caseInsensitive ? 'gi' : 'g';
    const regex = new RegExp(pattern, flags);
    const results: Array<{ uri: string; matches: string[] }> = [];

    for (const row of rows) {
      const matches: string[] = [];
      const lines = (row.content ?? '').split('\n');
      for (const line of lines) {
        if (regex.test(line)) {
          matches.push(line);
        }
        regex.lastIndex = 0;
      }

      if (matches.length > 0) {
        results.push({ uri: row.uri, matches });
      }

      if (nodeLimit !== undefined && results.length >= nodeLimit) {
        break;
      }
    }

    return results;
  }

  async glob(pattern: string, uri?: string, nodeLimit?: number): Promise<string[]> {
    const baseUri = uri ? this.normalizeUri(uri) : 'viking://';
    const dbPattern = baseUri === 'viking://' ? 'viking://%' : `${baseUri}/%`;

    const rows = await this.repo.find({
      where: { uri: Like(dbPattern) },
      select: ['uri'],
      order: { uri: 'ASC' },
    });

    const globRegex = globToRegex(pattern);
    let matches = rows
      .map((r) => r.uri)
      .filter((u) => globRegex.test(u));

    if (nodeLimit !== undefined && nodeLimit > 0) {
      matches = matches.slice(0, nodeLimit);
    }

    return matches;
  }
}

function globToRegex(pattern: string): RegExp {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i++;
        if (pattern[i + 1] === '/') {
          i++;
        }
      } else {
        regex += '[^/]*';
      }
    } else if (c === '?') {
      regex += '[^/]';
    } else if (c === '.') {
      regex += '\\.';
    } else if (c === '(' || c === ')' || c === '[' || c === ']' || c === '{' || c === '}' || c === '+' || c === '^' || c === '$' || c === '|' || c === '\\') {
      regex += `\\${c}`;
    } else {
      regex += c;
    }
  }
  return new RegExp(regex);
}
