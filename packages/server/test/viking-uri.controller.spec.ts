import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { VikingUriController } from '../src/viking-uri/viking-uri.controller';
import { DatabaseService } from '../src/storage/database.service';
import { VfsService } from '../src/storage/vfs.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-uri-ctrl-test-'));
}

describe('VikingUriController (HTTP)', () => {
  let app: INestApplication;
  let vfs: VfsService;

  beforeEach(async () => {
    const tempDir = createTempDir();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ storage: { path: tempDir } })],
        }),
      ],
      controllers: [VikingUriController],
      providers: [DatabaseService, VfsService],
    }).compile();

    await module.init();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    vfs = module.get(VfsService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/ls', () => {
    it('should list children at a URI', async () => {
      await vfs.mkdir('viking://resources');
      await vfs.writeFile('viking://resources/doc1.md', 'content1');
      await vfs.writeFile('viking://resources/doc2.md', 'content2');

      const response = await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://resources' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.children).toHaveLength(2);
      expect(response.body.result.children).toEqual(
        expect.arrayContaining([
          'viking://resources/doc1.md',
          'viking://resources/doc2.md',
        ]),
      );
    });

    it('should return 400 when uri is missing', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/ls')
        .expect(400);
    });

    it('should return empty children when no matches', async () => {
      await vfs.mkdir('viking://resources');

      const response = await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://resources' })
        .expect(200);

      expect(response.body.result.children).toHaveLength(0);
    });
  });

  describe('GET /api/v1/tree', () => {
    it('should return tree view', async () => {
      await vfs.writeFile('viking://resources/doc1.md', 'content');

      const response = await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://resources' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.type).toBe('directory');
      expect(response.body.result.children).toBeDefined();
    });

    it('should return 400 when uri is missing', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/tree')
        .expect(400);
    });

    it('should include time field in response', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://resources' })
        .expect(200);

      expect(response.body.time).toBeDefined();
      expect(typeof response.body.time).toBe('number');
    });
  });
});
