import { Test, TestingModule } from '@nestjs/testing';
import { ObserverController } from '../../src/queue/observer.controller';
import { EmbeddingQueueService } from '../../src/queue/embedding-queue.service';
import { SemanticQueueService } from '../../src/queue/semantic-queue.service';
import { ContextVectorService } from '../../src/storage/context-vector.service';
import { LlmService } from '../../src/llm/llm.service';
import { ComponentStatus, SystemStatus } from '../../src/shared/types';

function createMockQueueService(stats = { queued: 0, active: 0, processed: 10, errors: 0 }) {
  return { getStats: jest.fn().mockReturnValue(stats) };
}

function createMockContextVector(recordCount = 55) {
  return { count: jest.fn().mockReturnValue(recordCount) };
}

function createMockLlmService(overrides: {
  configured?: boolean;
  provider?: string;
  model?: string;
  stats?: { calls: number; inputTokens: number; outputTokens: number; byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }> };
} = {}) {
  const {
    configured = true,
    provider = 'openai',
    model = 'gpt-4o-mini',
    stats = { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {} },
  } = overrides;

  return {
    isConfigured: jest.fn().mockReturnValue(configured),
    getProviderName: jest.fn().mockReturnValue(provider),
    getModelName: jest.fn().mockReturnValue(model),
    getUsageStats: jest.fn().mockReturnValue(stats),
  };
}

describe('ObserverController', () => {
  let controller: ObserverController;
  let embeddingQueue: ReturnType<typeof createMockQueueService>;
  let semanticQueue: ReturnType<typeof createMockQueueService>;
  let contextVector: ReturnType<typeof createMockContextVector>;
  let llmService: ReturnType<typeof createMockLlmService>;

  beforeEach(async () => {
    embeddingQueue = createMockQueueService({ queued: 0, active: 0, processed: 10, errors: 0 });
    semanticQueue = createMockQueueService({ queued: 0, active: 0, processed: 10, errors: 0 });
    contextVector = createMockContextVector(55);
    llmService = createMockLlmService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObserverController],
      providers: [
        { provide: EmbeddingQueueService, useValue: embeddingQueue },
        { provide: SemanticQueueService, useValue: semanticQueue },
        { provide: ContextVectorService, useValue: contextVector },
        { provide: LlmService, useValue: llmService },
      ],
    }).compile();

    controller = module.get(ObserverController);
  });

  describe('GET /observer/queue', () => {
    it('should return ComponentStatus with queue stats', () => {
      const result = controller.getQueue();
      expect(result.status).toBe('ok');

      const component = result.result as ComponentStatus;
      expect(component.name).toBe('queue');
      expect(component.is_healthy).toBe(true);
      expect(component.has_errors).toBe(false);
      expect(component.status).toContain('Embedding');
      expect(component.status).toContain('Semantic');
      expect(component.status).toContain('TOTAL');
    });

    it('should report unhealthy when queue has errors', () => {
      embeddingQueue.getStats.mockReturnValue({ queued: 0, active: 0, processed: 8, errors: 2 });

      const result = controller.getQueue();
      const component = result.result as ComponentStatus;
      expect(component.is_healthy).toBe(false);
      expect(component.has_errors).toBe(true);
    });
  });

  describe('GET /observer/queues (alias)', () => {
    it('should return same ComponentStatus as /queue', () => {
      const queueResult = controller.getQueue();
      const queuesResult = controller.getQueues();

      expect(queueResult.status).toBe('ok');
      expect(queuesResult.status).toBe('ok');
      expect((queueResult.result as ComponentStatus).name).toBe('queue');
      expect((queuesResult.result as ComponentStatus).name).toBe('queue');
    });
  });

  describe('GET /observer/vikingdb', () => {
    it('should return ComponentStatus with record count', () => {
      const result = controller.getVikingdb();
      expect(result.status).toBe('ok');

      const component = result.result as ComponentStatus;
      expect(component.name).toBe('vikingdb');
      expect(component.is_healthy).toBe(true);
      expect(component.has_errors).toBe(false);
      expect(component.status).toContain('context  55  OK');
      expect(component.status).toContain('TOTAL  55');
    });

    it('should report unhealthy when count() throws', () => {
      contextVector.count.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = controller.getVikingdb();
      const component = result.result as ComponentStatus;
      expect(component.is_healthy).toBe(false);
      expect(component.has_errors).toBe(true);
      expect(component.status).toContain('ERROR');
    });
  });

  describe('GET /observer/vlm', () => {
    it('should return ComponentStatus with zero usage when no calls made', () => {
      const result = controller.getVlm();
      expect(result.status).toBe('ok');

      const component = result.result as ComponentStatus;
      expect(component.name).toBe('vlm');
      expect(component.is_healthy).toBe(true);
      expect(component.has_errors).toBe(false);
      expect(component.status).toContain('TOTAL  0  0  0  0');
    });

    it('should return usage stats when calls have been made', () => {
      llmService.getUsageStats.mockReturnValue({
        calls: 5,
        inputTokens: 1000,
        outputTokens: 500,
        byModel: {
          'openai/gpt-4o-mini': { calls: 5, inputTokens: 1000, outputTokens: 500 },
        },
      });

      const result = controller.getVlm();
      const component = result.result as ComponentStatus;
      expect(component.status).toContain('gpt-4o-mini  openai  5  1000  500  1500');
      expect(component.status).toContain('TOTAL  5  1000  500  1500');
    });

    it('should report unhealthy when provider/apiKey not configured', () => {
      llmService.isConfigured.mockReturnValue(false);

      const result = controller.getVlm();
      const component = result.result as ComponentStatus;
      expect(component.is_healthy).toBe(false);
    });
  });

  describe('GET /observer/system', () => {
    it('should return SystemStatus with all three components', () => {
      const result = controller.getSystem();
      expect(result.status).toBe('ok');

      const system = result.result as SystemStatus;
      expect(system.is_healthy).toBe(true);
      expect(system.errors).toEqual([]);
      expect(system.components['queue']).toBeDefined();
      expect(system.components['vikingdb']).toBeDefined();
      expect(system.components['vlm']).toBeDefined();
    });

    it('should aggregate unhealthy status from components', () => {
      llmService.isConfigured.mockReturnValue(false);
      embeddingQueue.getStats.mockReturnValue({ queued: 0, active: 0, processed: 5, errors: 3 });

      const result = controller.getSystem();
      const system = result.result as SystemStatus;

      expect(system.is_healthy).toBe(false);
      expect(system.errors).toContain('queue: has processing errors');
      expect(system.errors).toContain('vlm: not configured');
    });
  });
});
