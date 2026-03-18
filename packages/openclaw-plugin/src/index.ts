import { VikingClient } from './client';
import { ProcessManager } from './process-manager';
import { sanitizeTextForCapture, shouldCapture } from './text-utils';

export interface PluginConfig {
  mode: 'local' | 'remote';
  baseUrl?: string;
  apiKey?: string;
  port?: number;
  storagePath?: string;
  agentId?: string;
  autoRecall?: boolean;
  recallLimit?: number;
  recallScoreThreshold?: number;
  autoCapture?: boolean;
  captureMode?: 'semantic' | 'keyword';
}

export interface ContextEngineMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MemorySearchResult {
  id: string;
  uri: string;
  text: string;
  score: number;
  l0Abstract: string;
  category?: string;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface ContextEngine {
  info: { id: string; name: string; version: string };
  init(config: PluginConfig): Promise<void>;
  shutdown(): Promise<void>;
  autoRecall(query: string): Promise<MemorySearchResult[]>;
  autoCapture(messages: ContextEngineMessage[]): Promise<number>;
  handleTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<ToolResult>;
}

export function createContextEngine(): ContextEngine {
  let client: VikingClient | undefined;
  let processManager: ProcessManager | undefined;
  let config: PluginConfig;

  return {
    info: {
      id: 'viking-ts',
      name: 'Viking TS Context Engine',
      version: '0.1.0',
    },

    async init(pluginConfig: PluginConfig): Promise<void> {
      config = pluginConfig;

      if (config.mode === 'local') {
        const port = config.port ?? 1934;
        processManager = new ProcessManager();
        await processManager.startServer(port, config.storagePath);
        client = new VikingClient(`http://127.0.0.1:${port}`, config.apiKey);
      } else {
        if (!config.baseUrl) {
          throw new Error('baseUrl is required in remote mode');
        }
        client = new VikingClient(config.baseUrl, config.apiKey);
      }

      const healthy = await client.healthCheck();
      if (!healthy) {
        throw new Error('viking-ts server is not healthy');
      }

      if (config.agentId) {
        client.setAgentId(config.agentId);
      }
    },

    async shutdown(): Promise<void> {
      if (processManager) {
        processManager.stopServer();
        processManager = undefined;
      }
      client = undefined;
    },

    async autoRecall(query: string): Promise<MemorySearchResult[]> {
      if (!client || config.autoRecall === false) return [];

      try {
        return await client.search(query, {
          limit: config.recallLimit ?? 6,
          scoreThreshold: config.recallScoreThreshold ?? 0.01,
        });
      } catch {
        return [];
      }
    },

    async autoCapture(messages: ContextEngineMessage[]): Promise<number> {
      if (!client || config.autoCapture === false) return 0;

      const eligibleMessages = messages
        .map((m) => ({
          role: m.role,
          content: sanitizeTextForCapture(m.content),
        }))
        .filter((m) => shouldCapture(m.content, config.captureMode ?? 'semantic'));

      if (eligibleMessages.length === 0) return 0;

      try {
        const result = await client.captureSession(eligibleMessages, config.agentId);
        return result.memoriesExtracted;
      } catch {
        return 0;
      }
    },

    async handleTool(
      toolName: string,
      params: Record<string, unknown>,
    ): Promise<ToolResult> {
      if (!client) {
        return { content: 'viking-ts client not initialized', isError: true };
      }

      if (toolName === 'commit_memory') {
        const text = String(params['text'] ?? '');
        const category = String(params['category'] ?? 'general');

        if (!text) {
          return { content: 'text parameter is required', isError: true };
        }

        try {
          const memory = await client.commitMemory(text, category, config.agentId);
          return {
            content: `Memory stored successfully (id: ${memory.id}, category: ${category})`,
          };
        } catch (err) {
          return { content: `Failed to store memory: ${String(err)}`, isError: true };
        }
      }

      if (toolName === 'search_memories') {
        const query = String(params['query'] ?? '');
        const limit = Number(params['limit'] ?? 6);

        if (!query) {
          return { content: 'query parameter is required', isError: true };
        }

        try {
          const results = await client.search(query, { limit });
          if (results.length === 0) {
            return { content: 'No relevant memories found.' };
          }

          const formatted = results
            .map((r, i) => `${i + 1}. [${r.category ?? 'general'}] ${r.text} (score: ${r.score.toFixed(3)})`)
            .join('\n');
          return { content: formatted };
        } catch (err) {
          return { content: `Search failed: ${String(err)}`, isError: true };
        }
      }

      return { content: `Unknown tool: ${toolName}`, isError: true };
    },
  };
}

export { VikingClient } from './client';
export { ProcessManager } from './process-manager';
