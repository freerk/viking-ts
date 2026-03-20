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
    it('should insert and retrieve a memory by ID', () => {
      const memory = makeMemory();
      store.insertMemory(memory);

      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(memory.id);
      expect(retrieved?.text).toBe(memory.text);
      expect(retrieved?.type).toBe('user');
      expect(retrieved?.category).toBe('general');
      expect(retrieved?.uri).toBe(memory.uri);
    });

    it('should return undefined for non-existent memory ID', () => {
      const result = store.getMemoryById('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should preserve optional fields (agentId, userId)', () => {
      const memory = makeMemory({ agentId: 'agent-1', userId: 'user-1' });
      store.insertMemory(memory);

      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved?.agentId).toBe('agent-1');
      expect(retrieved?.userId).toBe('user-1');
    });

    it('should return undefined for agentId/userId when not set', () => {
      const memory = makeMemory();
      store.insertMemory(memory);

      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved?.agentId).toBeUndefined();
      expect(retrieved?.userId).toBeUndefined();
    });

    it('should delete a memory and return true', () => {
      const memory = makeMemory();
      store.insertMemory(memory);

      const deleted = store.deleteMemory(memory.id);
      expect(deleted).toBe(true);
      expect(store.getMemoryById(memory.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent memory', () => {
      const deleted = store.deleteMemory('non-existent');
      expect(deleted).toBe(false);
    });

    it('should update memory fields', () => {
      const memory = makeMemory({ text: 'Original text' });
      store.insertMemory(memory);

      const updated = store.updateMemory(memory.id, {
        text: 'Updated text',
        l0Abstract: 'Updated abstract',
      });

      expect(updated).toBe(true);
      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved?.text).toBe('Updated text');
      expect(retrieved?.l0Abstract).toBe('Updated abstract');
      expect(retrieved?.l1Overview).toBe('Overview');
    });

    it('should return false when updating with no fields', () => {
      const memory = makeMemory();
      store.insertMemory(memory);
      const updated = store.updateMemory(memory.id, {});
      expect(updated).toBe(false);
    });

    it('should return false when updating non-existent memory', () => {
      const updated = store.updateMemory('non-existent', { text: 'new' });
      expect(updated).toBe(false);
    });

    it('should update the updatedAt timestamp on update', () => {
      const memory = makeMemory({
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.insertMemory(memory);

      store.updateMemory(memory.id, { text: 'Changed' });
      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved?.updatedAt).not.toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('listMemories', () => {
    it('should list all memories when no filters', () => {
      store.insertMemory(makeMemory());
      store.insertMemory(makeMemory());
      store.insertMemory(makeMemory());

      const all = store.listMemories({});
      expect(all).toHaveLength(3);
    });

    it('should filter by type', () => {
      store.insertMemory(makeMemory({ type: 'user' }));
      store.insertMemory(makeMemory({ type: 'agent' }));

      const userMemories = store.listMemories({ type: 'user' });
      expect(userMemories).toHaveLength(1);
      expect(userMemories[0]?.type).toBe('user');
    });

    it('should filter by category', () => {
      store.insertMemory(makeMemory({ category: 'preferences' }));
      store.insertMemory(makeMemory({ category: 'general' }));

      const prefs = store.listMemories({ category: 'preferences' });
      expect(prefs).toHaveLength(1);
      expect(prefs[0]?.category).toBe('preferences');
    });

    it('should filter by agentId', () => {
      store.insertMemory(makeMemory({ agentId: 'agent-a' }));
      store.insertMemory(makeMemory({ agentId: 'agent-b' }));

      const result = store.listMemories({ agentId: 'agent-a' });
      expect(result).toHaveLength(1);
      expect(result[0]?.agentId).toBe('agent-a');
    });

    it('should filter by userId', () => {
      store.insertMemory(makeMemory({ userId: 'user-x' }));
      store.insertMemory(makeMemory({ userId: 'user-y' }));

      const result = store.listMemories({ userId: 'user-x' });
      expect(result).toHaveLength(1);
      expect(result[0]?.userId).toBe('user-x');
    });

    it('should combine multiple filters', () => {
      store.insertMemory(makeMemory({ type: 'user', category: 'preferences', userId: 'u1' }));
      store.insertMemory(makeMemory({ type: 'user', category: 'general', userId: 'u1' }));
      store.insertMemory(makeMemory({ type: 'agent', category: 'preferences' }));

      const result = store.listMemories({ type: 'user', category: 'preferences' });
      expect(result).toHaveLength(1);
    });

    it('should paginate with limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        store.insertMemory(makeMemory());
      }

      const page1 = store.listMemories({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = store.listMemories({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = store.listMemories({ limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });

    it('should return empty array when no memories match', () => {
      store.insertMemory(makeMemory({ type: 'user' }));

      const result = store.listMemories({ type: 'agent' });
      expect(result).toHaveLength(0);
    });

    it('should order by created_at DESC', () => {
      const m1 = makeMemory({ createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' });
      const m2 = makeMemory({ createdAt: '2025-06-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' });
      store.insertMemory(m1);
      store.insertMemory(m2);

      const all = store.listMemories({});
      expect(all[0]?.id).toBe(m2.id);
      expect(all[1]?.id).toBe(m1.id);
    });
  });

  describe('Resource CRUD', () => {
    it('should insert and retrieve a resource by ID', () => {
      const resource = makeResource();
      store.insertResource(resource);

      const retrieved = store.getResourceById(resource.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(resource.id);
      expect(retrieved?.title).toBe('Test resource');
    });

    it('should return undefined for non-existent resource ID', () => {
      expect(store.getResourceById('nope')).toBeUndefined();
    });

    it('should preserve sourceUrl when provided', () => {
      const resource = makeResource({ sourceUrl: 'https://example.com' });
      store.insertResource(resource);

      const retrieved = store.getResourceById(resource.id);
      expect(retrieved?.sourceUrl).toBe('https://example.com');
    });

    it('should return undefined sourceUrl when not set', () => {
      const resource = makeResource();
      store.insertResource(resource);

      const retrieved = store.getResourceById(resource.id);
      expect(retrieved?.sourceUrl).toBeUndefined();
    });

    it('should delete a resource and return true', () => {
      const resource = makeResource();
      store.insertResource(resource);

      expect(store.deleteResource(resource.id)).toBe(true);
      expect(store.getResourceById(resource.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent resource', () => {
      expect(store.deleteResource('nope')).toBe(false);
    });

    it('should list resources with pagination', () => {
      for (let i = 0; i < 5; i++) {
        store.insertResource(makeResource());
      }

      const page1 = store.listResources(2, 0);
      expect(page1).toHaveLength(2);

      const page2 = store.listResources(2, 2);
      expect(page2).toHaveLength(2);

      const all = store.listResources(100, 0);
      expect(all).toHaveLength(5);
    });

    it('should return empty array when no resources exist', () => {
      const result = store.listResources();
      expect(result).toHaveLength(0);
    });
  });

  describe('Session CRUD', () => {
    it('should insert and retrieve a session by ID', () => {
      const session = makeSession({ agentId: 'a1', userId: 'u1' });
      store.insertSession(session);

      const retrieved = store.getSessionById(session.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
      expect(retrieved?.agentId).toBe('a1');
      expect(retrieved?.userId).toBe('u1');
    });

    it('should return undefined for non-existent session', () => {
      expect(store.getSessionById('nope')).toBeUndefined();
    });

    it('should delete a session', () => {
      const session = makeSession();
      store.insertSession(session);

      expect(store.deleteSession(session.id)).toBe(true);
      expect(store.getSessionById(session.id)).toBeUndefined();
    });

    it('should return false when deleting non-existent session', () => {
      expect(store.deleteSession('nope')).toBe(false);
    });

    it('should cascade delete session messages when session is deleted', () => {
      const session = makeSession();
      store.insertSession(session);
      store.insertSessionMessage(makeSessionMessage(session.id));
      store.insertSessionMessage(makeSessionMessage(session.id));

      store.deleteSession(session.id);

      const messages = store.getSessionMessages(session.id);
      expect(messages).toHaveLength(0);
    });
  });

  describe('Session Messages', () => {
    it('should insert and retrieve session messages', () => {
      const session = makeSession();
      store.insertSession(session);

      store.insertSessionMessage(makeSessionMessage(session.id, { role: 'user', content: 'Hi' }));
      store.insertSessionMessage(makeSessionMessage(session.id, { role: 'assistant', content: 'Hello' }));

      const messages = store.getSessionMessages(session.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('Hi');
      expect(messages[1]?.role).toBe('assistant');
      expect(messages[1]?.content).toBe('Hello');
    });

    it('should return empty array for session with no messages', () => {
      const session = makeSession();
      store.insertSession(session);

      const messages = store.getSessionMessages(session.id);
      expect(messages).toHaveLength(0);
    });

    it('should order messages by created_at ASC', () => {
      const session = makeSession();
      store.insertSession(session);

      store.insertSessionMessage(
        makeSessionMessage(session.id, { content: 'First', createdAt: '2025-01-01T00:00:00Z' }),
      );
      store.insertSessionMessage(
        makeSessionMessage(session.id, { content: 'Second', createdAt: '2025-01-01T00:00:01Z' }),
      );

      const messages = store.getSessionMessages(session.id);
      expect(messages[0]?.content).toBe('First');
      expect(messages[1]?.content).toBe('Second');
    });

    it('should return empty array for non-existent session messages', () => {
      const messages = store.getSessionMessages('no-such-session');
      expect(messages).toHaveLength(0);
    });
  });

  describe('Memory update edge cases', () => {
    it('should update l1Overview independently', () => {
      const memory = makeMemory();
      store.insertMemory(memory);

      store.updateMemory(memory.id, { l1Overview: 'New overview' });
      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved?.l1Overview).toBe('New overview');
      expect(retrieved?.l0Abstract).toBe('Abstract');
    });

    it('should update l2Content independently', () => {
      const memory = makeMemory();
      store.insertMemory(memory);

      store.updateMemory(memory.id, { l2Content: 'New full content' });
      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved?.l2Content).toBe('New full content');
      expect(retrieved?.text).toBe('Test memory text');
    });

    it('should update all fields at once', () => {
      const memory = makeMemory();
      store.insertMemory(memory);

      store.updateMemory(memory.id, {
        text: 'New text',
        l0Abstract: 'New abstract',
        l1Overview: 'New overview',
        l2Content: 'New content',
      });

      const retrieved = store.getMemoryById(memory.id);
      expect(retrieved?.text).toBe('New text');
      expect(retrieved?.l0Abstract).toBe('New abstract');
      expect(retrieved?.l1Overview).toBe('New overview');
      expect(retrieved?.l2Content).toBe('New content');
    });
  });

  describe('Resource listing edge cases', () => {
    it('should list resources ordered by created_at DESC', () => {
      const r1 = makeResource({ createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' });
      const r2 = makeResource({ createdAt: '2025-06-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' });
      store.insertResource(r1);
      store.insertResource(r2);

      const all = store.listResources();
      expect(all[0]?.id).toBe(r2.id);
      expect(all[1]?.id).toBe(r1.id);
    });

    it('should handle large offset beyond total resources', () => {
      store.insertResource(makeResource());

      const result = store.listResources(10, 100);
      expect(result).toHaveLength(0);
    });
  });
});
