import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EmbeddingService } from '../src/embedding/embedding.service';

const DIMENSION = 256;
const FAKE_EMBEDDING = new Array(DIMENSION).fill(0.42) as number[];

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: { create: mockCreate },
    })),
  };
});

describe('EmbeddingService', () => {
  let module: TestingModule;
  let service: EmbeddingService;

  beforeEach(async () => {
    mockCreate.mockReset();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              embedding: {
                provider: 'openai',
                model: 'text-embedding-3-small',
                apiKey: 'test-key',
                apiBase: 'http://localhost:9999',
                dimension: DIMENSION,
              },
            }),
          ],
        }),
      ],
      providers: [EmbeddingService],
    }).compile();

    await module.init();
    service = module.get(EmbeddingService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('getDimension', () => {
    it('should return the configured dimension', () => {
      expect(service.getDimension()).toBe(DIMENSION);
    });
  });

  describe('embed', () => {
    it('should return embedding vector for non-empty text', async () => {
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: FAKE_EMBEDDING }],
      });

      const result = await service.embed('Hello world');
      expect(result).toEqual(FAKE_EMBEDDING);
      expect(result).toHaveLength(DIMENSION);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should return zero vector for empty text', async () => {
      const result = await service.embed('');
      expect(result).toHaveLength(DIMENSION);
      expect(result.every((v) => v === 0)).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return zero vector for whitespace-only text', async () => {
      const result = await service.embed('   \n\t  ');
      expect(result).toHaveLength(DIMENSION);
      expect(result.every((v) => v === 0)).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should throw when provider returns no embedding', async () => {
      mockCreate.mockResolvedValueOnce({ data: [] });
      await expect(service.embed('Hello')).rejects.toThrow('No embedding returned from provider');
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API rate limit'));
      await expect(service.embed('Hello')).rejects.toThrow('API rate limit');
    });
  });

  describe('embedBatch', () => {
    it('should return embeddings for multiple texts', async () => {
      mockCreate.mockResolvedValueOnce({
        data: [
          { embedding: FAKE_EMBEDDING },
          { embedding: FAKE_EMBEDDING },
        ],
      });

      const result = await service.embedBatch(['Hello', 'World']);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(FAKE_EMBEDDING);
      expect(result[1]).toEqual(FAKE_EMBEDDING);
    });

    it('should return zero vectors for all-empty input', async () => {
      const result = await service.embedBatch(['', '  ']);
      expect(result).toHaveLength(2);
      expect(result[0]?.every((v) => v === 0)).toBe(true);
      expect(result[1]?.every((v) => v === 0)).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should handle mixed empty and non-empty texts', async () => {
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: FAKE_EMBEDDING }],
      });

      const result = await service.embedBatch(['', 'Hello', '  ']);
      expect(result).toHaveLength(3);
      expect(result[0]?.every((v) => v === 0)).toBe(true);
      expect(result[1]).toEqual(FAKE_EMBEDDING);
      expect(result[2]?.every((v) => v === 0)).toBe(true);
    });

    it('should propagate API errors in batch', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Batch rate limit'));
      await expect(service.embedBatch(['Hello', 'World'])).rejects.toThrow('Batch rate limit');
    });

    it('should return empty array for empty input array', async () => {
      const result = await service.embedBatch([]);
      expect(result).toHaveLength(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should fall back to zero vector when API returns fewer embeddings than expected', async () => {
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: FAKE_EMBEDDING }],
      });

      // Two non-empty texts but API only returns 1 embedding
      const result = await service.embedBatch(['Hello', 'World']);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(FAKE_EMBEDDING);
      // Second should fall back to zero vector
      expect(result[1]).toHaveLength(DIMENSION);
      expect(result[1]?.every((v) => v === 0)).toBe(true);
    });
  });

  describe('embed edge cases', () => {
    it('should pass model and dimensions to API', async () => {
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: FAKE_EMBEDDING }],
      });

      await service.embed('Test text');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'text-embedding-3-small',
          dimensions: DIMENSION,
        }),
      );
    });

    it('should trim input before sending to API', async () => {
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: FAKE_EMBEDDING }],
      });

      await service.embed('  Hello world  ');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: 'Hello world' }),
      );
    });
  });
});
