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

const searchMemoriesSchema = {
  query: z.string(),
  limit: z.number().optional(),
};

const addMemorySchema = {
  text: z.string(),
  category: z.enum(['profile', 'preferences', 'entities', 'events', 'cases', 'patterns', 'general']).optional(),
  agentId: z.string().optional(),
};

const listMemoriesSchema = {
  limit: z.number().optional(),
  agentId: z.string().optional(),
};

export function registerMemoryTools(server: McpServer, config: VikingConfig): void {
  server.tool(
    'search_memories',
    'Semantic search over stored memories. Returns the most relevant matches for a natural-language query.',
    searchMemoriesSchema,
    async ({ query, limit }) => {
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set('limit', String(limit));

      const results = await vikingFetch<unknown[]>(config, `/api/v1/memories/search?${params.toString()}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.tool(
    'add_memory',
    'Store a new memory. The server generates semantic abstracts automatically.',
    addMemorySchema,
    async ({ text, category, agentId }) => {
      const body: Record<string, string> = { text };
      if (category !== undefined) body['category'] = category;
      if (agentId !== undefined) body['agentId'] = agentId;

      const result = await vikingFetch<unknown>(config, '/api/v1/memories', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'list_memories',
    'List stored memories, optionally filtered by agent.',
    listMemoriesSchema,
    async ({ limit, agentId }) => {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      if (agentId !== undefined) params.set('agentId', agentId);
      const qs = params.toString();

      const results = await vikingFetch<unknown[]>(config, `/api/v1/memories${qs ? `?${qs}` : ''}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );
}
