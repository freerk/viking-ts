import { z } from 'zod/v3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface VikingConfig {
  baseUrl: string;
}

interface ApiResponse<T> {
  status: 'ok' | 'error';
  result?: T;
  error?: { code: string; message: string };
}

async function vikingFetch<T>(config: VikingConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  const body = (await res.json()) as ApiResponse<T>;
  if (body.status === 'error') {
    throw new Error(body.error?.message ?? `Viking API error on ${path}`);
  }
  return body.result as T;
}

const searchResourcesSchema = {
  query: z.string(),
  limit: z.number().optional(),
};

const addResourceSchema = {
  title: z.string(),
  content: z.string(),
  uri: z.string().optional(),
};

const listResourcesSchema = {
  limit: z.number().optional(),
};

export function registerResourceTools(server: McpServer, config: VikingConfig): void {
  server.tool(
    'search_resources',
    'Semantic search over stored resources (documents, files, notes).',
    searchResourcesSchema,
    async ({ query, limit }) => {
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set('limit', String(limit));

      const results = await vikingFetch<unknown[]>(config, `/api/v1/resources/search?${params.toString()}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.tool(
    'add_resource',
    'Store a new resource (document, file, or note). The server generates semantic abstracts automatically.',
    addResourceSchema,
    async ({ title, content, uri }) => {
      const body: Record<string, string> = { title, text: content };
      if (uri !== undefined) body['uri'] = uri;

      const result = await vikingFetch<unknown>(config, '/api/v1/resources', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'list_resources',
    'List all stored resources.',
    listResourcesSchema,
    async ({ limit }) => {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      const qs = params.toString();

      const results = await vikingFetch<unknown[]>(config, `/api/v1/resources${qs ? `?${qs}` : ''}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );
}
