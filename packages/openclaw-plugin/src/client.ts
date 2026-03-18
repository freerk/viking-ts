import { z } from 'zod';

const SearchResultSchema = z.object({
  id: z.string(),
  uri: z.string(),
  text: z.string(),
  score: z.number(),
  l0Abstract: z.string(),
  category: z.string().optional(),
  type: z.string().optional(),
});

const MemorySchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.string(),
  category: z.string(),
  uri: z.string(),
  l0Abstract: z.string(),
  l1Overview: z.string(),
  l2Content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ApiResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

type SearchResult = z.infer<typeof SearchResultSchema>;
type Memory = z.infer<typeof MemorySchema>;

export class VikingClient {
  private agentId: string = 'default';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  setAgentId(agentId: string): void {
    this.agentId = agentId;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      const data: unknown = await response.json();
      return (
        typeof data === 'object' &&
        data !== null &&
        'status' in data &&
        (data as Record<string, unknown>)['status'] === 'ok'
      );
    } catch {
      return false;
    }
  }

  async search(
    query: string,
    options: { limit?: number; scoreThreshold?: number; uri?: string } = {},
  ): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.scoreThreshold !== undefined) params.set('scoreThreshold', String(options.scoreThreshold));
    if (options.uri) params.set('uri', options.uri);

    const response = await this.request(`/api/v1/memories/search?${params.toString()}`);
    const body = ApiResponseSchema.parse(response);

    if (body.status === 'error') {
      throw new Error(body.error?.message ?? 'Search failed');
    }

    const results = z.array(SearchResultSchema).parse(body.result);
    return results;
  }

  async commitMemory(
    text: string,
    category: string = 'general',
    agentId?: string,
  ): Promise<Memory> {
    const response = await this.request('/api/v1/memories', {
      method: 'POST',
      body: JSON.stringify({
        text,
        category,
        type: 'user',
        agentId: agentId ?? this.agentId,
      }),
    });

    const body = ApiResponseSchema.parse(response);
    if (body.status === 'error') {
      throw new Error(body.error?.message ?? 'Commit failed');
    }

    return MemorySchema.parse(body.result);
  }

  async captureSession(
    messages: Array<{ role: string; content: string }>,
    agentId?: string,
  ): Promise<{ memoriesExtracted: number }> {
    const response = await this.request('/api/v1/sessions/capture', {
      method: 'POST',
      body: JSON.stringify({
        messages,
        agentId: agentId ?? this.agentId,
      }),
    });

    const body = ApiResponseSchema.parse(response);
    if (body.status === 'error') {
      throw new Error(body.error?.message ?? 'Capture failed');
    }

    const result = z
      .object({ memoriesExtracted: z.number() })
      .parse(body.result);
    return result;
  }

  async deleteMemory(uri: string): Promise<void> {
    const response = await this.request(`/api/v1/memories/${encodeURIComponent(uri)}`, {
      method: 'DELETE',
    });

    const body = ApiResponseSchema.parse(response);
    if (body.status === 'error') {
      throw new Error(body.error?.message ?? 'Delete failed');
    }
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
      'X-Viking-Agent': this.agentId,
    };

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: init.signal ?? AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return response.json();
  }
}
