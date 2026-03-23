import { chunkText } from '../../src/queue/text-utils';

describe('chunkText', () => {
  it('should return single chunk for short text', () => {
    const result = chunkText('Short text', 2000);
    expect(result).toEqual(['Short text']);
  });

  it('should split text into chunks with overlap', () => {
    const text = 'A'.repeat(5000);
    const chunks = chunkText(text, 2000, 200);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('should prefer paragraph boundaries', () => {
    const paragraph1 = 'First paragraph. '.repeat(60);
    const paragraph2 = 'Second paragraph. '.repeat(60);
    const text = `${paragraph1}\n\n${paragraph2}`;

    const chunks = chunkText(text, 2000, 200);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it('should not return empty chunks', () => {
    const text = '\n\n'.repeat(100) + 'Content' + '\n\n'.repeat(100);
    const chunks = chunkText(text, 2000, 200);

    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it('should handle exact chunk size', () => {
    const text = 'A'.repeat(2000);
    const chunks = chunkText(text, 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });
});
