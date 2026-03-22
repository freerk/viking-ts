import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MetadataStoreService } from '../../src/storage/metadata-store.service';
import { MemoryRecord, ResourceRecord, SessionRecord, SessionMessage } from '../../src/shared/types';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-meta-test-'));
}

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const id = overrides.id ?? uuid();
  const now = new Date().toISOString();
  return {
    id,
    text: 'Test memory text',
    type: 'user',
    category: 'general',
    uri: `viking://user/memories/general/${id}.md`,
    l0Abstract: 'Abstract',
    l1Overview: 'Overview',
    l2Content: 'Test memory text',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeResource(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  const id = overrides.id ?? uuid();
  const now = new Date().toISOString();
  return {
    id,
    title: 'Test resource',
    uri: `viking://resources/${id}.md`,
    l0Abstract: 'Abstract',
    l1Overview: 'Overview',
    l2Content: 'Resource content',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSessionMessage(sessionId: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: uuid(),
    sessionId,
    role: 'user',
    content: 'Hello',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MetadataStoreService', () => {
  let module: TestingModule;
  let store: MetadataStoreService;

  beforeEach(async () => {
    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ storage: { path: tempDir } })],
        }),
      ],
      providers: [MetadataStoreService],
    }).compile();

    await module.init();
    store = module.get(MetadataStoreService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('Memory CRUD', () => {
    it('should insert and retrieve a memory by ID', async () => {
      const memory = makeMemory();
      await store.insertMemory(memory);

      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(memory.id);
      expect(retrieved?.text).toBe(memory.text);
      expect(retrieved?.type).toBe('user');
      expect(retrieved?.category).toBe('general');
      expect(retrieved?.uri).toBe(memory.uri);
    });

    it('should return undefined for non-existent memory ID', async () => {
      const result = await store.getMemoryById('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should preserve optional fields (agentId, userId)', async () => {
      const memory = makeMemory({ agentId: 'agent-1', userId: 'user-1' });
      await store.insertMemory(memory);

      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved?.agentId).toBe('agent-1');
      expect(retrieved?.userId).toBe('user-1');
    });

    it('should return undefined for agentId/userId when not set', async () => {
      const memory = makeMemory();
      await store.insertMemory(memory);

      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved?.agentId).toBeUndefined();
      expect(retrieved?.userId).toBeUndefined();
    });

    it('should delete a memory and return true', async () => {
      const memory = makeMemory();
      await store.insertMemory(memory);

      const deleted = await store.deleteMemory(memory.id);
      expect(deleted).toBe(true);
      expect(await store.getMemoryById(memory.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent memory', async () => {
      const deleted = await store.deleteMemory('non-existent');
      expect(deleted).toBe(false);
    });

    it('should update memory fields', async () => {
      const memory = makeMemory({ text: 'Original text' });
      await store.insertMemory(memory);

      const updated = await store.updateMemory(memory.id, {
        text: 'Updated text',
        l0Abstract: 'Updated abstract',
      });

      expect(updated).toBe(true);
      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved?.text).toBe('Updated text');
      expect(retrieved?.l0Abstract).toBe('Updated abstract');
      expect(retrieved?.l1Overview).toBe('Overview');
    });

    it('should return false when updating with no fields', async () => {
      const memory = makeMemory();
      await store.insertMemory(memory);
      const updated = await store.updateMemory(memory.id, {});
      expect(updated).toBe(false);
    });

    it('should return false when updating non-existent memory', async () => {
      const updated = await store.updateMemory('non-existent', { text: 'new' });
      expect(updated).toBe(false);
    });

    it('should update the updatedAt timestamp on update', async () => {
      const memory = makeMemory({
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      await store.insertMemory(memory);

      await store.updateMemory(memory.id, { text: 'Changed' });
      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved?.updatedAt).not.toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('listMemories', () => {
    it('should list all memories when no filters', async () => {
      await store.insertMemory(makeMemory());
      await store.insertMemory(makeMemory());
      await store.insertMemory(makeMemory());

      const all = await store.listMemories({});
      expect(all).toHaveLength(3);
    });

    it('should filter by type', async () => {
      await store.insertMemory(makeMemory({ type: 'user' }));
      await store.insertMemory(makeMemory({ type: 'agent' }));

      const userMemories = await store.listMemories({ type: 'user' });
      expect(userMemories).toHaveLength(1);
      expect(userMemories[0]?.type).toBe('user');
    });

    it('should filter by category', async () => {
      await store.insertMemory(makeMemory({ category: 'preferences' }));
      await store.insertMemory(makeMemory({ category: 'general' }));

      const prefs = await store.listMemories({ category: 'preferences' });
      expect(prefs).toHaveLength(1);
      expect(prefs[0]?.category).toBe('preferences');
    });

    it('should filter by agentId', async () => {
      await store.insertMemory(makeMemory({ agentId: 'agent-a' }));
      await store.insertMemory(makeMemory({ agentId: 'agent-b' }));

      const result = await store.listMemories({ agentId: 'agent-a' });
      expect(result).toHaveLength(1);
      expect(result[0]?.agentId).toBe('agent-a');
    });

    it('should filter by userId', async () => {
      await store.insertMemory(makeMemory({ userId: 'user-x' }));
      await store.insertMemory(makeMemory({ userId: 'user-y' }));

      const result = await store.listMemories({ userId: 'user-x' });
      expect(result).toHaveLength(1);
      expect(result[0]?.userId).toBe('user-x');
    });

    it('should combine multiple filters', async () => {
      await store.insertMemory(makeMemory({ type: 'user', category: 'preferences', userId: 'u1' }));
      await store.insertMemory(makeMemory({ type: 'user', category: 'general', userId: 'u1' }));
      await store.insertMemory(makeMemory({ type: 'agent', category: 'preferences' }));

      const result = await store.listMemories({ type: 'user', category: 'preferences' });
      expect(result).toHaveLength(1);
    });

    it('should paginate with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.insertMemory(makeMemory());
      }

      const page1 = await store.listMemories({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await store.listMemories({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = await store.listMemories({ limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });

    it('should return empty array when no memories match', async () => {
      await store.insertMemory(makeMemory({ type: 'user' }));

      const result = await store.listMemories({ type: 'agent' });
      expect(result).toHaveLength(0);
    });

    it('should order by created_at DESC', async () => {
      const m1 = makeMemory({ createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' });
      const m2 = makeMemory({ createdAt: '2025-06-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' });
      await store.insertMemory(m1);
      await store.insertMemory(m2);

      const all = await store.listMemories({});
      expect(all[0]?.id).toBe(m2.id);
      expect(all[1]?.id).toBe(m1.id);
    });
  });

  describe('Resource CRUD', () => {
    it('should insert and retrieve a resource by ID', async () => {
      const resource = makeResource();
      await store.insertResource(resource);

      const retrieved = await store.getResourceById(resource.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(resource.id);
      expect(retrieved?.title).toBe('Test resource');
    });

    it('should return undefined for non-existent resource ID', async () => {
      expect(await store.getResourceById('nope')).toBeUndefined();
    });

    it('should preserve sourceUrl when provided', async () => {
      const resource = makeResource({ sourceUrl: 'https://example.com' });
      await store.insertResource(resource);

      const retrieved = await store.getResourceById(resource.id);
      expect(retrieved?.sourceUrl).toBe('https://example.com');
    });

    it('should return undefined sourceUrl when not set', async () => {
      const resource = makeResource();
      await store.insertResource(resource);

      const retrieved = await store.getResourceById(resource.id);
      expect(retrieved?.sourceUrl).toBeUndefined();
    });

    it('should delete a resource and return true', async () => {
      const resource = makeResource();
      await store.insertResource(resource);

      expect(await store.deleteResource(resource.id)).toBe(true);
      expect(await store.getResourceById(resource.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent resource', async () => {
      expect(await store.deleteResource('nope')).toBe(false);
    });

    it('should list resources with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.insertResource(makeResource());
      }

      const page1 = await store.listResources(2, 0);
      expect(page1).toHaveLength(2);

      const page2 = await store.listResources(2, 2);
      expect(page2).toHaveLength(2);

      const all = await store.listResources(100, 0);
      expect(all).toHaveLength(5);
    });

    it('should return empty array when no resources exist', async () => {
      const result = await store.listResources();
      expect(result).toHaveLength(0);
    });
  });

  describe('Session CRUD', () => {
    it('should insert and retrieve a session by ID', async () => {
      const session = makeSession({ agentId: 'a1', userId: 'u1' });
      await store.insertSession(session);

      const retrieved = await store.getSessionById(session.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
      expect(retrieved?.agentId).toBe('a1');
      expect(retrieved?.userId).toBe('u1');
    });

    it('should return undefined for non-existent session', async () => {
      expect(await store.getSessionById('nope')).toBeUndefined();
    });

    it('should delete a session', async () => {
      const session = makeSession();
      await store.insertSession(session);

      expect(await store.deleteSession(session.id)).toBe(true);
      expect(await store.getSessionById(session.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent session', async () => {
      expect(await store.deleteSession('nope')).toBe(false);
    });

    it('should cascade delete session messages when session is deleted', async () => {
      const session = makeSession();
      await store.insertSession(session);
      await store.insertSessionMessage(makeSessionMessage(session.id));
      await store.insertSessionMessage(makeSessionMessage(session.id));

      await store.deleteSession(session.id);

      const messages = await store.getSessionMessages(session.id);
      expect(messages).toHaveLength(0);
    });
  });

  describe('Session Messages', () => {
    it('should insert and retrieve session messages', async () => {
      const session = makeSession();
      await store.insertSession(session);

      await store.insertSessionMessage(makeSessionMessage(session.id, { role: 'user', content: 'Hi' }));
      await store.insertSessionMessage(makeSessionMessage(session.id, { role: 'assistant', content: 'Hello' }));

      const messages = await store.getSessionMessages(session.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('Hi');
      expect(messages[1]?.role).toBe('assistant');
      expect(messages[1]?.content).toBe('Hello');
    });

    it('should return empty array for session with no messages', async () => {
      const session = makeSession();
      await store.insertSession(session);

      const messages = await store.getSessionMessages(session.id);
      expect(messages).toHaveLength(0);
    });

    it('should order messages by created_at ASC', async () => {
      const session = makeSession();
      await store.insertSession(session);

      await store.insertSessionMessage(
        makeSessionMessage(session.id, { content: 'First', createdAt: '2025-01-01T00:00:00Z' }),
      );
      await store.insertSessionMessage(
        makeSessionMessage(session.id, { content: 'Second', createdAt: '2025-01-01T00:00:01Z' }),
      );

      const messages = await store.getSessionMessages(session.id);
      expect(messages[0]?.content).toBe('First');
      expect(messages[1]?.content).toBe('Second');
    });

    it('should return empty array for non-existent session messages', async () => {
      const messages = await store.getSessionMessages('no-such-session');
      expect(messages).toHaveLength(0);
    });
  });

  describe('Memory update edge cases', () => {
    it('should update l1Overview independently', async () => {
      const memory = makeMemory();
      await store.insertMemory(memory);

      await store.updateMemory(memory.id, { l1Overview: 'New overview' });
      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved?.l1Overview).toBe('New overview');
      expect(retrieved?.l0Abstract).toBe('Abstract');
    });

    it('should update l2Content independently', async () => {
      const memory = makeMemory();
      await store.insertMemory(memory);

      await store.updateMemory(memory.id, { l2Content: 'New full content' });
      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved?.l2Content).toBe('New full content');
      expect(retrieved?.text).toBe('Test memory text');
    });

    it('should update all fields at once', async () => {
      const memory = makeMemory();
      await store.insertMemory(memory);

      await store.updateMemory(memory.id, {
        text: 'New text',
        l0Abstract: 'New abstract',
        l1Overview: 'New overview',
        l2Content: 'New content',
      });

      const retrieved = await store.getMemoryById(memory.id);
      expect(retrieved?.text).toBe('New text');
      expect(retrieved?.l0Abstract).toBe('New abstract');
      expect(retrieved?.l1Overview).toBe('New overview');
      expect(retrieved?.l2Content).toBe('New content');
    });
  });

  describe('Resource listing edge cases', () => {
    it('should list resources ordered by created_at DESC', async () => {
      const r1 = makeResource({ createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' });
      const r2 = makeResource({ createdAt: '2025-06-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' });
      await store.insertResource(r1);
      await store.insertResource(r2);

      const all = await store.listResources();
      expect(all[0]?.id).toBe(r2.id);
      expect(all[1]?.id).toBe(r1.id);
    });

    it('should handle large offset beyond total resources', async () => {
      await store.insertResource(makeResource());

      const result = await store.listResources(10, 100);
      expect(result).toHaveLength(0);
    });
  });
});
