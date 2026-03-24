import { Injectable, Optional, Logger } from '@nestjs/common';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { VfsService, TreeNode } from '../storage/vfs.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { ConflictError } from '../shared/errors';

export function validateZipEntryPath(zipPath: string, baseName: string): void {
  if (!zipPath) throw new Error('Empty zip entry path');
  if (zipPath.includes('\\')) throw new Error(`Unsafe path: ${zipPath}`);
  if (zipPath.startsWith('/')) throw new Error(`Unsafe path: ${zipPath}`);
  if (/^[a-zA-Z]:/.test(zipPath)) throw new Error(`Unsafe path: ${zipPath}`);
  if (zipPath.includes('..')) throw new Error(`Unsafe path: ${zipPath}`);
  const parts = zipPath.split('/').filter(Boolean);
  if (parts[0] !== baseName) throw new Error(`Invalid root in zip: ${zipPath}`);
}

function getRelPath(zipPath: string, baseName: string): string {
  const prefix = baseName + '/';
  return zipPath.startsWith(prefix) ? zipPath.slice(prefix.length) : zipPath;
}

@Injectable()
export class PackService {
  private readonly logger = new Logger(PackService.name);

  constructor(
    private readonly vfs: VfsService,
    @Optional() private readonly embeddingQueue?: EmbeddingQueueService,
  ) {}

  async exportOvpack(uri: string, to: string): Promise<string> {
    if (!to.endsWith('.ovpack')) {
      to = to + '.ovpack';
    }

    const tree = await this.vfs.tree(uri);
    const baseName = tree.name;

    const zip = new AdmZip();

    zip.addFile(`${baseName}/`, Buffer.alloc(0));

    const meta = {
      uri,
      exported_at: new Date().toISOString(),
      version: '1.0',
    };
    zip.addFile(
      `${baseName}/_._meta.json`,
      Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'),
    );

    await this.walkTreeForExport(zip, tree, baseName, uri);

    const dir = path.dirname(to);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    zip.writeZip(to);
    this.logger.log(`Exported ${uri} → ${to}`);
    return to;
  }

  async importOvpack(
    filePath: string,
    parent: string,
    force: boolean,
    vectorize: boolean,
  ): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    if (entries.length === 0) {
      throw new Error('Empty zip archive');
    }

    const firstEntry = entries[0];
    if (!firstEntry) {
      throw new Error('Empty zip archive');
    }
    const firstPath = firstEntry.entryName;
    const baseName = firstPath.split('/').filter(Boolean)[0];

    if (!baseName) {
      throw new Error('Cannot determine base name from zip');
    }

    const rootUri = parent.replace(/\/+$/, '') + '/' + baseName;

    const exists = await this.vfs.exists(rootUri);
    if (exists && !force) {
      throw new ConflictError(`URI already exists: ${rootUri}`);
    }

    const writtenUris: string[] = [];

    for (const entry of entries) {
      validateZipEntryPath(entry.entryName, baseName);

      const relPath = getRelPath(entry.entryName, baseName);
      if (!relPath) {
        continue;
      }

      const targetUri = rootUri + '/' + relPath.replace(/\/+$/, '');

      if (entry.isDirectory) {
        await this.vfs.mkdir(targetUri);
      } else {
        const content = entry.getData().toString('utf-8');
        await this.vfs.writeFile(targetUri, content);
        writtenUris.push(targetUri);
      }
    }

    if (vectorize && this.embeddingQueue) {
      for (const fileUri of writtenUris) {
        const parts = fileUri.split('/');
        const name = parts[parts.length - 1] ?? fileUri;
        this.embeddingQueue.enqueue({
          uri: fileUri,
          text: '',
          contextType: 'resource',
          level: 2,
          abstract: '',
          name,
          parentUri: rootUri,
          accountId: 'default',
          ownerSpace: 'default',
        });
      }
    }

    this.logger.log(`Imported ${filePath} → ${rootUri}`);
    return rootUri;
  }

  private async walkTreeForExport(
    zip: AdmZip,
    node: TreeNode,
    baseName: string,
    rootUri: string,
  ): Promise<void> {
    if (!node.children) {
      return;
    }

    for (const child of node.children) {
      const relPath = this.getRelativeUri(child.uri, rootUri);
      const zipPath = `${baseName}/${relPath}`;

      if (child.isDir) {
        zip.addFile(`${zipPath}/`, Buffer.alloc(0));
        await this.walkTreeForExport(zip, child, baseName, rootUri);
      } else {
        const content = await this.vfs.readFile(child.uri);
        zip.addFile(zipPath, Buffer.from(content, 'utf-8'));
      }
    }
  }

  private getRelativeUri(childUri: string, rootUri: string): string {
    const prefix = rootUri.endsWith('/') ? rootUri : rootUri + '/';
    if (childUri.startsWith(prefix)) {
      return childUri.slice(prefix.length);
    }
    return childUri;
  }
}
