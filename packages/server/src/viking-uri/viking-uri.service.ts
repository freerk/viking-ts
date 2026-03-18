import { Injectable } from '@nestjs/common';
import { VikingNode } from '../shared/types';

const VALID_SCOPES = ['resources', 'user', 'agent', 'session', 'queue', 'temp'] as const;
type VikingScope = (typeof VALID_SCOPES)[number];

export interface ParsedUri {
  scope: VikingScope;
  path: string;
  fullPath: string;
  isDirectory: boolean;
}

@Injectable()
export class VikingUriService {
  parse(uri: string): ParsedUri {
    if (!uri.startsWith('viking://')) {
      throw new Error(`Invalid Viking URI: must start with viking:// (got "${uri}")`);
    }

    const rest = uri.slice('viking://'.length);
    const slashIndex = rest.indexOf('/');
    const scope = slashIndex === -1 ? rest : rest.slice(0, slashIndex);

    if (!VALID_SCOPES.includes(scope as VikingScope)) {
      throw new Error(`Invalid Viking URI scope: "${scope}". Must be one of: ${VALID_SCOPES.join(', ')}`);
    }

    const path = slashIndex === -1 ? '' : rest.slice(slashIndex + 1);
    const isDirectory = uri.endsWith('/') || path === '';

    return {
      scope: scope as VikingScope,
      path: path.replace(/\/$/, ''),
      fullPath: rest.replace(/\/$/, ''),
      isDirectory,
    };
  }

  build(scope: VikingScope, ...segments: string[]): string {
    const path = segments.filter(Boolean).join('/');
    return `viking://${scope}/${path}`;
  }

  parentUri(uri: string): string | undefined {
    const parsed = this.parse(uri);
    if (!parsed.path) return undefined;

    const parts = parsed.path.split('/');
    parts.pop();
    if (parts.length === 0) return `viking://${parsed.scope}/`;
    return `viking://${parsed.scope}/${parts.join('/')}/`;
  }

  buildTree(uris: string[], rootUri: string, depth: number): VikingNode {
    const parsed = this.parse(rootUri);
    const rootPrefix = parsed.fullPath;

    const root: VikingNode = {
      uri: rootUri,
      name: parsed.path ? (parsed.path.split('/').pop() ?? parsed.scope) : parsed.scope,
      type: 'directory',
      children: [],
    };

    if (depth <= 0) return root;

    const childMap = new Map<string, VikingNode>();

    for (const uri of uris) {
      const uriParsed = this.parse(uri);
      const relativePath = uriParsed.fullPath.startsWith(rootPrefix)
        ? uriParsed.fullPath.slice(rootPrefix.length).replace(/^\//, '')
        : '';

      if (!relativePath) continue;

      const segments = relativePath.split('/');
      if (segments.length > depth) continue;

      const name = segments[segments.length - 1] ?? '';
      const node: VikingNode = {
        uri,
        name,
        type: uriParsed.isDirectory ? 'directory' : 'file',
      };

      if (segments.length === 1) {
        childMap.set(name, node);
      }
    }

    root.children = Array.from(childMap.values());
    return root;
  }
}
