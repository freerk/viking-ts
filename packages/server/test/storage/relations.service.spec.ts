import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from '../../src/storage/database.service';
import { RelationsService } from '../../src/storage/relations.service';
import { InvalidUriError } from '../../src/shared/errors';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-rel-test-'));
}

describe('RelationsService', () => {
  let module: TestingModule;
  let relations: RelationsService;

  beforeEach(async () => {
    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ storage: { path: tempDir } })],
        }),
      ],
      providers: [DatabaseService, RelationsService],
    }).compile();

    await module.init();
    relations = module.get(RelationsService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('link', () => {
    it('should create relations between URIs', async () => {
      const created = await relations.link(
        'viking://resources/a.md',
        ['viking://resources/b.md', 'viking://resources/c.md'],
        'related content',
      );

      expect(created).toHaveLength(2);
      expect(created[0]?.fromUri).toBe('viking://resources/a.md');
      expect(created[0]?.toUri).toBe('viking://resources/b.md');
      expect(created[0]?.reason).toBe('related content');
    });

    it('should not create duplicate relations', async () => {
      await relations.link('viking://resources/a.md', ['viking://resources/b.md']);
      const second = await relations.link('viking://resources/a.md', ['viking://resources/b.md']);
      expect(second).toHaveLength(0);
    });

    it('should throw InvalidUriError for invalid URIs', async () => {
      await expect(
        relations.link('invalid', ['viking://resources/b.md']),
      ).rejects.toThrow(InvalidUriError);
    });
  });

  describe('getRelations', () => {
    it('should return relations for a URI', async () => {
      await relations.link(
        'viking://resources/a.md',
        ['viking://resources/b.md', 'viking://resources/c.md'],
      );

      const rels = await relations.getRelations('viking://resources/a.md');
      expect(rels).toHaveLength(2);
    });

    it('should return empty array when no relations exist', async () => {
      const rels = await relations.getRelations('viking://resources/lonely.md');
      expect(rels).toHaveLength(0);
    });
  });

  describe('unlink', () => {
    it('should remove a relation', async () => {
      await relations.link('viking://resources/a.md', ['viking://resources/b.md']);
      const deleted = await relations.unlink('viking://resources/a.md', 'viking://resources/b.md');
      expect(deleted).toBe(true);

      const rels = await relations.getRelations('viking://resources/a.md');
      expect(rels).toHaveLength(0);
    });

    it('should return false when relation does not exist', async () => {
      const deleted = await relations.unlink('viking://resources/x.md', 'viking://resources/y.md');
      expect(deleted).toBe(false);
    });
  });
});
