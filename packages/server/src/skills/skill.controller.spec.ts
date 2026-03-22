import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import { SkillRecord } from '../shared/types';

function makeSkillRecord(overrides?: Partial<SkillRecord>): SkillRecord {
  const now = new Date().toISOString();
  return {
    id: 'skill-123',
    name: 'test-skill',
    description: 'A test skill',
    uri: 'viking://agent/skills/test-skill/',
    tags: ['test'],
    l0Abstract: 'Test abstract',
    l1Overview: 'Test overview',
    l2Content: 'Full content',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SkillController', () => {
  let app: INestApplication;
  const mockService = {
    createSkill: jest.fn(),
    searchSkills: jest.fn(),
    getSkill: jest.fn(),
    listSkills: jest.fn(),
    deleteSkill: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SkillController],
      providers: [
        { provide: SkillService, useValue: mockService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/skills', () => {
    it('should create a skill and return 201', async () => {
      const skill = makeSkillRecord();
      mockService.createSkill.mockResolvedValue(skill);

      const res = await request(app.getHttpServer())
        .post('/api/v1/skills')
        .send({
          name: 'test-skill',
          description: 'A test skill',
          content: 'Full content',
          tags: ['test'],
        })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.name).toBe('test-skill');
      expect(res.body.time).toBeDefined();
    });

    it('should reject missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/skills')
        .send({ name: 'only-name' })
        .expect(400);
    });

    it('should reject unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/skills')
        .send({
          name: 'test',
          description: 'desc',
          content: 'c',
          unknownField: 'bad',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/skills/search', () => {
    it('should search skills', async () => {
      mockService.searchSkills.mockResolvedValue([
        { id: '1', uri: 'viking://agent/skills/x/', text: 'x', score: 0.9, l0Abstract: 'x' },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/skills/search?q=react')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result).toHaveLength(1);
      expect(mockService.searchSkills).toHaveBeenCalledWith('react', 10, 0.01);
    });

    it('should reject missing query', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/skills/search')
        .expect(400);
    });
  });

  describe('GET /api/v1/skills', () => {
    it('should list skills', async () => {
      mockService.listSkills.mockResolvedValue([makeSkillRecord()]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/skills')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result).toHaveLength(1);
    });

    it('should pass tag filter', async () => {
      mockService.listSkills.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/skills?tag=react')
        .expect(200);

      expect(mockService.listSkills).toHaveBeenCalledWith(100, 0, 'react');
    });
  });

  describe('GET /api/v1/skills/:id', () => {
    it('should get a skill by id', async () => {
      mockService.getSkill.mockResolvedValue(makeSkillRecord());

      const res = await request(app.getHttpServer())
        .get('/api/v1/skills/skill-123')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.id).toBe('skill-123');
    });
  });

  describe('DELETE /api/v1/skills/:id', () => {
    it('should delete a skill and return 204', async () => {
      mockService.deleteSkill.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .delete('/api/v1/skills/skill-123')
        .expect(204);

      expect(mockService.deleteSkill).toHaveBeenCalledWith('skill-123');
    });
  });
});
