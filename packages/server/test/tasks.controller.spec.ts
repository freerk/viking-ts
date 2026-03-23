import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TasksController } from '../src/tasks/tasks.controller';
import { TaskTrackerService } from '../src/tasks/task-tracker.service';

describe('TasksController (HTTP)', () => {
  let app: INestApplication;
  let taskTracker: TaskTrackerService;

  beforeEach(async () => {
    taskTracker = new TaskTrackerService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TaskTrackerService, useValue: taskTracker }],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/tasks/:task_id', () => {
    it('should return a task by ID', async () => {
      const task = taskTracker.create('session_commit', 'session-1');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/tasks/${task.task_id}`)
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.task_id).toBe(task.task_id);
      expect(res.body.result.task_type).toBe('session_commit');
      expect(res.body.result.status).toBe('pending');
    });

    it('should return 404 for unknown task', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks/nonexistent-id')
        .expect(404);

      expect(res.body.status).toBe('error');
    });
  });

  describe('GET /api/v1/tasks', () => {
    it('should return all tasks', async () => {
      taskTracker.create('session_commit', 'session-1');
      taskTracker.create('resource_reindex', 'uri-1');

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result).toHaveLength(2);
    });

    it('should filter by task_type', async () => {
      taskTracker.create('session_commit', 'session-1');
      taskTracker.create('resource_reindex', 'uri-1');

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks?task_type=session_commit')
        .expect(200);

      expect(res.body.result).toHaveLength(1);
      expect(res.body.result[0].task_type).toBe('session_commit');
    });

    it('should filter by status', async () => {
      const task = taskTracker.create('session_commit', 'session-1');
      taskTracker.start(task.task_id);
      taskTracker.create('resource_reindex', 'uri-1');

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks?status=running')
        .expect(200);

      expect(res.body.result).toHaveLength(1);
      expect(res.body.result[0].status).toBe('running');
    });

    it('should respect limit parameter', async () => {
      taskTracker.create('a', 'r1');
      taskTracker.create('b', 'r2');
      taskTracker.create('c', 'r3');

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks?limit=2')
        .expect(200);

      expect(res.body.result).toHaveLength(2);
    });
  });
});

describe('TaskTrackerService', () => {
  let service: TaskTrackerService;

  beforeEach(() => {
    service = new TaskTrackerService();
  });

  it('should create a task with pending status', () => {
    const task = service.create('session_commit', 'session-1');
    expect(task.status).toBe('pending');
    expect(task.task_type).toBe('session_commit');
    expect(task.resource_id).toBe('session-1');
  });

  it('should transition through lifecycle states', () => {
    const task = service.create('test', 'r1');
    expect(task.status).toBe('pending');

    service.start(task.task_id);
    expect(service.get(task.task_id)?.status).toBe('running');
    expect(service.get(task.task_id)?.started_at).toBeDefined();

    service.complete(task.task_id, { count: 5 });
    const completed = service.get(task.task_id);
    expect(completed?.status).toBe('completed');
    expect(completed?.completed_at).toBeDefined();
    expect(completed?.result).toEqual({ count: 5 });
  });

  it('should mark tasks as failed with error message', () => {
    const task = service.create('test', 'r1');
    service.start(task.task_id);
    service.fail(task.task_id, 'something went wrong');

    const failed = service.get(task.task_id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('something went wrong');
  });

  it('should detect running tasks via hasRunning', () => {
    const task = service.create('commit', 'session-1');
    service.start(task.task_id);

    expect(service.hasRunning('commit', 'session-1')).toBe(true);
    expect(service.hasRunning('commit', 'session-2')).toBe(false);
  });

  it('should return null from createIfNoRunning when task exists', () => {
    const task = service.create('commit', 'session-1');
    service.start(task.task_id);

    expect(service.createIfNoRunning('commit', 'session-1')).toBeNull();
  });

  it('should create from createIfNoRunning when no running task', () => {
    const task = service.createIfNoRunning('commit', 'session-1');
    expect(task).not.toBeNull();
    expect(task?.task_type).toBe('commit');
  });

  it('should filter list results', () => {
    service.create('a', 'r1');
    service.create('b', 'r2');

    expect(service.list({ taskType: 'a' })).toHaveLength(1);
    expect(service.list({ resourceId: 'r2' })).toHaveLength(1);
    expect(service.list()).toHaveLength(2);
  });
});
