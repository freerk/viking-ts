import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillService } from './skill.service';
import { MetadataStoreService } from '../storage/metadata-store.service';
import { VectorStoreService } from '../storage/vector-store.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';
import { VikingUriService } from '../viking-uri/viking-uri.service';
import { NotFoundException } from '@nestjs/common';

describe('SkillService', () => {
  let module: TestingModule;
  let service: SkillService;
  let tmpDir: string;

  const mockEmbedding = jest.fn().mockResolvedValue(new Array(384).fill(0.1));
  const mockGenerateAbstract = jest.fn().mockResolvedValue('Generated abstract');
  const mockGenerateOverview = jest.fn().mockResolvedValue('Generated overview');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'viking-skill-test-'));

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              storage: { path: tmpDir },
              embedding: {
                apiKey: 'test',
                apiBase: 'http://localhost',
                model: 'test',
                dimension: 384,
              },
              llm: {
                apiKey: 'test',
                apiBase: 'http://localhost',
                model: 'test',
              },
            }),
          ],
        }),
      ],
      providers: [
        SkillService,
        MetadataStoreService,
        VectorStoreService,
        VikingUriService,
        {
          provide: EmbeddingService,
          useValue: {
            embed: mockEmbedding,
            embedBatch: jest.fn(),
            getDimension: () => 384,
          },
        },
        {
          provide: LlmService,
          useValue: {
            generateAbstract: mockGenerateAbstract,
            generateOverview: mockGenerateOverview,
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
    expect(result.l0Abstract).toBe('Generated abstract');
    expect(result.l1Overview).toBe('Generated overview');
    expect(result.l2Content).toBe('Full React skill content here');
    expect(mockGenerateAbstract).toHaveBeenCalledTimes(1);
    expect(mockGenerateOverview).toHaveBeenCalledTimes(1);
    expect(mockEmbedding).toHaveBeenCalledTimes(1);
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

  it('should list skills filtered by tag', async () => {
    const skills = await service.listSkills(100, 0, 'react');
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills.every((s: { tags: string[] }) => s.tags.includes('react'))).toBe(true);
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

  it('should gracefully degrade when LLM fails', async () => {
    mockGenerateAbstract.mockRejectedValueOnce(new Error('LLM down'));
    mockGenerateOverview.mockRejectedValueOnce(new Error('LLM down'));

    const result = await service.createSkill({
      name: 'fallback-test',
      description: 'Test fallback',
      content: 'A'.repeat(200),
    });

    expect(result.l0Abstract).toBe('A'.repeat(100));
    expect(result.l1Overview).toBe('A'.repeat(200));
  });
});
