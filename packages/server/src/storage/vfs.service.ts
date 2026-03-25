import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
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

interface VfsRow {
  uri: string;
  parent_uri: string | null;
  name: string;
  is_dir: number;
  content: string | null;
  content_bytes: Buffer | null;
  size: number;
  created_at: string;
  updated_at: string;
}

const VIKING_URI_REGEX = /^viking:\/\//;

@Injectable()
export class VfsService {

  constructor(private readonly database: DatabaseService) {}

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

  private rowToEntry(row: VfsRow): VfsEntry {
    return {
      uri: row.uri,
      parentUri: row.parent_uri,
      name: row.name,
      isDir: row.is_dir === 1,
      size: row.size,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      content: row.content,
    };
  }

  async stat(uri: string): Promise<VfsEntry> {
    const normalized = this.normalizeUri(uri);
    const row = this.database.db
      .prepare('SELECT uri, parent_uri, name, is_dir, content, content_bytes, size, created_at, updated_at FROM vfs_nodes WHERE uri = ?')
      .get(normalized) as VfsRow | undefined;

    if (!row) {
      throw new NotFoundError(normalized);
    }

    return this.rowToEntry(row);
  }

  async exists(uri: string): Promise<boolean> {
    const normalized = this.normalizeUri(uri);
    const row = this.database.db
      .prepare('SELECT 1 FROM vfs_nodes WHERE uri = ?')
      .get(normalized) as { 1: number } | undefined;
    return row !== undefined;
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

    this.database.db
      .prepare(
        `INSERT INTO vfs_nodes (uri, parent_uri, name, is_dir, size, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(normalized, parent, name, now, now);

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

    this.database.db
      .prepare(
        `INSERT INTO vfs_nodes (uri, parent_uri, name, is_dir, content, size, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET content = excluded.content, size = excluded.size, updated_at = excluded.updated_at`,
      )
      .run(normalized, parent, name, content, size, now, now);

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
    const row = this.database.db
      .prepare('SELECT content FROM vfs_nodes WHERE uri = ? AND is_dir = 0')
      .get(normalized) as { content: string | null } | undefined;

    if (!row) {
      throw new NotFoundError(normalized);
    }

    return row.content ?? '';
  }

  async rm(uri: string, recursive: boolean = false): Promise<void> {
    const normalized = this.normalizeUri(uri);

    if (!(await this.exists(normalized))) {
      throw new NotFoundError(normalized);
    }

    if (recursive) {
      this.database.db
        .prepare('DELETE FROM vfs_nodes WHERE uri = ? OR uri LIKE ?')
        .run(normalized, `${normalized}/%`);
    } else {
      const children = this.database.db
        .prepare('SELECT 1 FROM vfs_nodes WHERE parent_uri = ? LIMIT 1')
        .get(normalized) as { 1: number } | undefined;

      if (children) {
        throw new ConflictError(`Directory not empty: ${normalized}`);
      }

      this.database.db
        .prepare('DELETE FROM vfs_nodes WHERE uri = ?')
        .run(normalized);
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

    const moveNode = this.database.db.transaction(() => {
      this.database.db
        .prepare('UPDATE vfs_nodes SET uri = ?, parent_uri = ?, name = ?, updated_at = ? WHERE uri = ?')
        .run(toNorm, toParent, toName, new Date().toISOString(), fromNorm);

      const children = this.database.db
        .prepare('SELECT uri FROM vfs_nodes WHERE uri LIKE ?')
        .all(`${fromNorm}/%`) as Array<{ uri: string }>;

      for (const child of children) {
        const newChildUri = toNorm + child.uri.slice(fromNorm.length);
        const newChildParent = this.parentUri(newChildUri) ?? toNorm;
        this.database.db
          .prepare('UPDATE vfs_nodes SET uri = ?, parent_uri = ?, updated_at = ? WHERE uri = ?')
          .run(newChildUri, newChildParent, new Date().toISOString(), child.uri);
      }
    });

    moveNode();
  }

  async ls(uri: string, options: LsOptions = {}): Promise<VfsEntry[]> {
    const normalized = uri === 'viking://' ? 'viking://' : this.normalizeUri(uri);
    const { recursive = false, showAllHidden = false, nodeLimit } = options;

    let rows: VfsRow[];

    if (recursive) {
      const pattern = normalized === 'viking://' ? 'viking://%' : `${normalized}/%`;
      rows = this.database.db
        .prepare('SELECT uri, parent_uri, name, is_dir, content, content_bytes, size, created_at, updated_at FROM vfs_nodes WHERE uri LIKE ? ORDER BY uri')
        .all(pattern) as VfsRow[];
    } else {
      rows = this.database.db
        .prepare('SELECT uri, parent_uri, name, is_dir, content, content_bytes, size, created_at, updated_at FROM vfs_nodes WHERE parent_uri = ? ORDER BY uri')
        .all(normalized) as VfsRow[];
    }

    let entries = rows.map((row) => this.rowToEntry(row));

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

    const rows = this.database.db
      .prepare('SELECT uri, content FROM vfs_nodes WHERE is_dir = 0 AND uri LIKE ? AND content IS NOT NULL')
      .all(dbPattern) as Array<{ uri: string; content: string }>;

    const flags = caseInsensitive ? 'gi' : 'g';
    const regex = new RegExp(pattern, flags);
    const results: Array<{ uri: string; matches: string[] }> = [];

    for (const row of rows) {
      const matches: string[] = [];
      const lines = row.content.split('\n');
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

    const rows = this.database.db
      .prepare('SELECT uri FROM vfs_nodes WHERE uri LIKE ? ORDER BY uri')
      .all(dbPattern) as Array<{ uri: string }>;

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
