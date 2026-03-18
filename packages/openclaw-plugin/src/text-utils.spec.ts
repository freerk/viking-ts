import { sanitizeTextForCapture, shouldCapture } from './text-utils';

describe('sanitizeTextForCapture', () => {
  it('should strip relevant-memories blocks', () => {
    const input = 'Hello <relevant-memories>some context</relevant-memories> world';
    expect(sanitizeTextForCapture(input)).toBe('Hello world');
  });

  it('should strip conversation-metadata blocks', () => {
    const input = 'Text <conversation-metadata>meta</conversation-metadata> here';
    expect(sanitizeTextForCapture(input)).toBe('Text here');
  });

  it('should normalize whitespace', () => {
    const input = '  hello   world  ';
    expect(sanitizeTextForCapture(input)).toBe('hello world');
  });
});

describe('shouldCapture', () => {
  it('should reject short text', () => {
    expect(shouldCapture('hi', 'semantic')).toBe(false);
  });

  it('should reject commands', () => {
    expect(shouldCapture('/help me with something', 'semantic')).toBe(false);
  });

  it('should accept normal text in semantic mode', () => {
    expect(shouldCapture('I prefer using TypeScript for all my projects', 'semantic')).toBe(true);
  });

  it('should accept trigger words in keyword mode', () => {
    expect(shouldCapture('Remember that I prefer dark mode always', 'keyword')).toBe(true);
  });

  it('should reject non-trigger text in keyword mode', () => {
    expect(shouldCapture('What is the weather today in San Francisco', 'keyword')).toBe(false);
  });

  it('should reject pure punctuation', () => {
    expect(shouldCapture('...!!!???', 'semantic')).toBe(false);
  });
});
