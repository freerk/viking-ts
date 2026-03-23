import { Injectable } from '@nestjs/common';
import { HierarchicalRetrieverService, RetrieveOptions } from './hierarchical-retriever.service';
import { VfsService } from '../storage/vfs.service';
import { MatchedContextResponse, GrepMatch } from './search.dto';

@Injectable()
export class SearchService {
  constructor(
    private readonly retriever: HierarchicalRetrieverService,
    private readonly vfs: VfsService,
  ) {}

  /**
   * Semantic search using hierarchical retrieval.
   */
  async find(opts: RetrieveOptions): Promise<MatchedContextResponse[]> {
    return this.retriever.retrieve(opts);
  }

  /**
   * Grep: line-by-line regex search over VFS file content.
   */
  async grep(
    uri: string,
    pattern: string,
    caseInsensitive: boolean = false,
    nodeLimit?: number,
  ): Promise<GrepMatch[]> {
    const results = await this.vfs.grep(uri, pattern, caseInsensitive, nodeLimit);
    const matches: GrepMatch[] = [];

    for (const result of results) {
      const content = await this.vfs.readFile(result.uri);
      const lines = content.split('\n');
      const flags = caseInsensitive ? 'gi' : 'g';
      const regex = new RegExp(pattern, flags);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        regex.lastIndex = 0;
        if (regex.test(line)) {
          const contextBefore: string[] = [];
          const contextAfter: string[] = [];

          for (let j = Math.max(0, i - 2); j < i; j++) {
            const beforeLine = lines[j];
            if (beforeLine !== undefined) {
              contextBefore.push(beforeLine);
            }
          }
          for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) {
            const afterLine = lines[j];
            if (afterLine !== undefined) {
              contextAfter.push(afterLine);
            }
          }

          matches.push({
            uri: result.uri,
            line_number: i + 1,
            line,
            context_before: contextBefore,
            context_after: contextAfter,
          });
        }
        regex.lastIndex = 0;
      }

      if (nodeLimit !== undefined && matches.length >= nodeLimit) {
        return matches.slice(0, nodeLimit);
      }
    }

    return matches;
  }

  /**
   * Glob: match VFS node URIs against a glob pattern.
   */
  async glob(
    pattern: string,
    uri?: string,
    nodeLimit?: number,
  ): Promise<string[]> {
    return this.vfs.glob(pattern, uri, nodeLimit);
  }
}
