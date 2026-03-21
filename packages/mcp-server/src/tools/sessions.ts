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

const captureSessionSchema = {
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
  agentId: z.string().optional(),
};

export function registerSessionTools(server: McpServer, config: VikingConfig): void {
  server.tool(
    'capture_session',
    'Ingest a conversation and automatically extract memories from it. ' +
    'The LLM analyzes the messages and stores relevant facts, preferences, and context as memories.',
    captureSessionSchema,
    async ({ messages, agentId }) => {
      const body: Record<string, unknown> = { messages };
      if (agentId !== undefined) body['agentId'] = agentId;

      const result = await vikingFetch<unknown>(config, '/api/v1/sessions/capture', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
