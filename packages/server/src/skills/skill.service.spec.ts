import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillService } from './skill.service';
import { VfsService } from '../storage/vfs.service';
import { ContextVectorService } from '../storage/context-vector.service';
import {
  ContextVectorEntity,
  VfsNodeEntity,
  RelationEntity,
  SessionEntity,
  SessionMessageEntity,
} from '../storage/entities';
import { EmbeddingService } from '../embedding/embedding.service';
import { NotFoundException } from '@nestjs/common';

const entities = [
  ContextVectorEntity,
  VfsNodeEntity,
  RelationEntity,
  SessionEntity,
  SessionMessageEntity,
];

describe('SkillService', () => {
  let module: TestingModule;
  let service: SkillService;
  let tmpDir: string;

  const mockEmbedding = jest.fn().mockResolvedValue(new Array(384).fill(0.1));

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'viking-skill-test-'));

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              storage: { path: tmpDir },
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: join(tmpDir, 'viking.db'),
          entities,
          synchronize: true,
        }),
        TypeOrmModule.forFeature(entities),
      ],
      providers: [
        SkillService,
        VfsService,
        ContextVectorService,
        {
          provide: EmbeddingService,
          useValue: {
            embed: mockEmbedding,
            embedBatch: jest.fn(),
            getDimension: () => 384,
          },
        },
      ],
    }).compile();

    await module.init();
    service = module.get(SkillService);
  });

  afterAll(async () => {
    await module.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a skill and return a SkillRecord', async () => {
    const result = await service.createSkill({
      name: 'react-expert',
      description: 'Expert React patterns',
      content: 'Full React skill content here',
      tags: ['react', 'frontend'],
    });

    expect(result.id).toBeDefined();
    expect(result.name).toBe('react-expert');
    expect(result.description).toBe('Expert React patterns');
    expect(result.uri).toBe('viking://agent/skills/react-expert/');
    expect(result.tags).toEqual(['react', 'frontend']);
    expect(result.l0Abstract).toBe('Full React skill content here');
    expect(result.l2Content).toBe('Full React skill content here');
  });

  it('should get a skill by id', async () => {
    const created = await service.createSkill({
      name: 'get-test',
      description: 'Test get',
      content: 'Content for get test',
    });

    const fetched = await service.getSkill(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('get-test');
  });

  it('should throw NotFoundException for missing skill', async () => {
    await expect(service.getSkill('nonexistent-id')).rejects.toThrow(NotFoundException);
  });

  it('should list skills', async () => {
    const skills = await service.listSkills(100, 0);
    expect(skills.length).toBeGreaterThanOrEqual(2);
  });

  it('should search skills by vector similarity', async () => {
    const results = await service.searchSkills('react patterns', 10, 0.0);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const first = results[0];
    expect(first).toBeDefined();
    expect(first!.score).toBeGreaterThanOrEqual(0);
  });

  it('should delete a skill', async () => {
    const created = await service.createSkill({
      name: 'delete-me',
      description: 'To be deleted',
      content: 'Delete test content',
    });

    await service.deleteSkill(created.id);
    await expect(service.getSkill(created.id)).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException when deleting missing skill', async () => {
    await expect(service.deleteSkill('nonexistent-id')).rejects.toThrow(NotFoundException);
  });

  it('should truncate l0Abstract to 256 chars', async () => {
    const result = await service.createSkill({
      name: 'long-content',
      description: 'Test truncation',
      content: 'A'.repeat(500),
    });

    expect(result.l0Abstract.length).toBeLessThanOrEqual(256);
  });
});
