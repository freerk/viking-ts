import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionController } from '../src/session/session.controller';
import { SessionService, SessionRecord } from '../src/session/session.service';
import { ConflictError, NotFoundError } from '../src/shared/errors';

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date().toISOString();
  return {
    session_id: 'sess-1',
    account_id: 'default',
    user_id: 'default',
    agent_id: 'default',
    status: 'active',
    message_count: 0,
    contexts_used: 0,
    skills_used: 0,
    compression_index: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('SessionController (HTTP)', () => {
  let app: INestApplication;
  let sessionService: Partial<Record<keyof SessionService, jest.Mock>>;

  beforeEach(async () => {
    sessionService = {
      create: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
      delete: jest.fn(),
      addMessage: jest.fn(),
      recordUsed: jest.fn(),
      commit: jest.fn(),
      commitAsync: jest.fn(),
      extract: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: SessionService, useValue: sessionService },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/v1/sessions', () => {
    it('should create a session and return session_id and user', async () => {
      sessionService.create!.mockResolvedValue(makeSession({ session_id: 'new-sess' }));

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions')
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.session_id).toBe('new-sess');
      expect(res.body.result.user.user_id).toBe('default');
      expect(res.body.result.user.agent_id).toBe('default');
    });
  });

  describe('GET /api/v1/sessions', () => {
    it('should list all sessions', async () => {
      sessionService.list!.mockResolvedValue([makeSession(), makeSession({ session_id: 'sess-2' })]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/sessions')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result).toHaveLength(2);
    });
  });

  describe('GET /api/v1/sessions/:id', () => {
    it('should return session with user and message_count', async () => {
      sessionService.get!.mockResolvedValue(makeSession({ session_id: 'sess-1', message_count: 5 }));

      const res = await request(app.getHttpServer())
        .get('/api/v1/sessions/sess-1')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.session_id).toBe('sess-1');
      expect(res.body.result.message_count).toBe(5);
      expect(res.body.result.user.user_id).toBe('default');
    });

    it('should return error for unknown session', async () => {
      sessionService.get!.mockRejectedValue(new NotFoundError('session:nonexistent'));

      const res = await request(app.getHttpServer())
        .get('/api/v1/sessions/nonexistent')
        .expect(200);

      expect(res.body.status).toBe('error');
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/sessions/:id', () => {
    it('should delete session and return session_id', async () => {
      sessionService.delete!.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/sessions/sess-1')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.session_id).toBe('sess-1');
    });

    it('should return error for unknown session', async () => {
      sessionService.delete!.mockRejectedValue(new NotFoundError('session:nonexistent'));

      const res = await request(app.getHttpServer())
        .delete('/api/v1/sessions/nonexistent')
        .expect(200);

      expect(res.body.status).toBe('error');
    });
  });

  describe('POST /api/v1/sessions/:id/commit', () => {
    it('should default to synchronous commit and return full result', async () => {
      sessionService.commit!.mockResolvedValue({
        session_id: 'sess-1',
        status: 'committed',
        archived: true,
        memories_extracted: 3,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/commit')
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.session_id).toBe('sess-1');
      expect(res.body.result.status).toBe('committed');
      expect(res.body.result.archived).toBe(true);
      expect(res.body.result.memories_extracted).toBe(3);
      expect(sessionService.commit).toHaveBeenCalledTimes(1);
      expect(sessionService.commitAsync).not.toHaveBeenCalled();
    });

    it('should return synchronous result when wait=true', async () => {
      sessionService.commit!.mockResolvedValue({
        session_id: 'sess-1',
        status: 'committed',
        archived: true,
        memories_extracted: 5,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/commit?wait=true')
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.status).toBe('committed');
      expect(res.body.result.memories_extracted).toBe(5);
      expect(sessionService.commit).toHaveBeenCalledTimes(1);
    });

    it('should return async result when wait=false', async () => {
      sessionService.commitAsync!.mockResolvedValue({
        session_id: 'sess-1',
        status: 'accepted',
        task_id: 'task-abc',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/commit?wait=false')
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.session_id).toBe('sess-1');
      expect(res.body.result.task_id).toBe('task-abc');
      expect(res.body.result.status).toBe('accepted');
      expect(res.body.result.message).toBe('Commit is processing in the background');
      expect(sessionService.commitAsync).toHaveBeenCalledTimes(1);
      expect(sessionService.commit).not.toHaveBeenCalled();
    });

    it('should return conflict if commit already in progress', async () => {
      sessionService.commitAsync!.mockRejectedValue(
        new ConflictError('Session sess-1 already has a commit in progress'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/commit?wait=false')
        .expect(201);

      expect(res.body.status).toBe('error');
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /api/v1/sessions/:id/extract', () => {
    it('should return extracted memories', async () => {
      sessionService.extract!.mockResolvedValue([
        { category: 'preferences', abstract: 'Likes TS', overview: '', content: 'User likes TypeScript', language: 'auto' },
      ]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/extract')
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.memories).toHaveLength(1);
      expect(res.body.result.memories[0].category).toBe('preferences');
    });

    it('should return empty memories for empty session', async () => {
      sessionService.extract!.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/extract')
        .expect(201);

      expect(res.body.result.memories).toHaveLength(0);
    });
  });

  describe('POST /api/v1/sessions/:id/messages', () => {
    it('should add message with string content', async () => {
      sessionService.addMessage!.mockResolvedValue(makeSession({ session_id: 'sess-1', message_count: 1 }));

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/messages')
        .send({ role: 'user', content: 'Hello' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.session_id).toBe('sess-1');
      expect(res.body.result.message_count).toBe(1);
    });

    it('should add message with parts array', async () => {
      sessionService.addMessage!.mockResolvedValue(makeSession({ session_id: 'sess-1', message_count: 2 }));

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/messages')
        .send({
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Here is the answer' },
            { type: 'context', uri: 'viking://resources/doc.md', abstract: 'Doc' },
          ],
        })
        .expect(201);

      expect(res.body.result.message_count).toBe(2);
      expect(sessionService.addMessage).toHaveBeenCalledWith(
        'sess-1',
        'assistant',
        [
          { type: 'text', text: 'Here is the answer' },
          { type: 'context', uri: 'viking://resources/doc.md', abstract: 'Doc' },
        ],
      );
    });

    it('should return error for unknown session', async () => {
      sessionService.addMessage!.mockRejectedValue(new NotFoundError('session:bad'));

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/bad/messages')
        .send({ role: 'user', content: 'test' })
        .expect(201);

      expect(res.body.status).toBe('error');
    });
  });

  describe('POST /api/v1/sessions/:id/used', () => {
    it('should record used contexts and skills', async () => {
      sessionService.recordUsed!.mockResolvedValue(makeSession({
        session_id: 'sess-1',
        contexts_used: 2,
        skills_used: 1,
      }));

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/used')
        .send({
          contexts: ['viking://resources/a.md', 'viking://resources/b.md'],
          skill: { uri: 'viking://agent/default/skills/code.md' },
        })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.session_id).toBe('sess-1');
      expect(res.body.result.contexts_used).toBe(2);
      expect(res.body.result.skills_used).toBe(1);
    });

    it('should handle contexts-only request', async () => {
      sessionService.recordUsed!.mockResolvedValue(makeSession({
        session_id: 'sess-1',
        contexts_used: 1,
        skills_used: 0,
      }));

      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/sess-1/used')
        .send({ contexts: ['viking://resources/a.md'] })
        .expect(201);

      expect(res.body.result.contexts_used).toBe(1);
      expect(res.body.result.skills_used).toBe(0);
    });
  });
});
