import { VikingUriService } from '../src/viking-uri/viking-uri.service';

describe('VikingUriService', () => {
  let service: VikingUriService;

  beforeEach(() => {
    service = new VikingUriService();
  });

  describe('parse', () => {
    it('should parse a valid file URI', () => {
      const result = service.parse('viking://resources/docs/api.md');
      expect(result.scope).toBe('resources');
      expect(result.path).toBe('docs/api.md');
      expect(result.isDirectory).toBe(false);
    });

    it('should parse a directory URI with trailing slash', () => {
      const result = service.parse('viking://user/memories/');
      expect(result.scope).toBe('user');
      expect(result.path).toBe('memories');
      expect(result.isDirectory).toBe(true);
    });

    it('should parse a scope-only URI', () => {
      const result = service.parse('viking://resources');
      expect(result.scope).toBe('resources');
      expect(result.path).toBe('');
      expect(result.isDirectory).toBe(true);
    });

    it('should throw for invalid prefix', () => {
      expect(() => service.parse('http://example.com')).toThrow('Invalid Viking URI');
    });

    it('should throw for invalid scope', () => {
      expect(() => service.parse('viking://invalid/path')).toThrow('Invalid Viking URI scope');
    });

    it('should handle all valid scopes', () => {
      for (const scope of ['resources', 'user', 'agent', 'session', 'queue', 'temp']) {
        const result = service.parse(`viking://${scope}/test`);
        expect(result.scope).toBe(scope);
      }
    });
  });

  describe('build', () => {
    it('should build a URI from scope and segments', () => {
      const uri = service.build('user', 'memories', 'preferences', 'theme.md');
      expect(uri).toBe('viking://user/memories/preferences/theme.md');
    });

    it('should handle empty segments', () => {
      const uri = service.build('resources', '', 'docs', '');
      expect(uri).toBe('viking://resources/docs');
    });
  });

  describe('parentUri', () => {
    it('should return parent directory URI', () => {
      const parent = service.parentUri('viking://resources/docs/api.md');
      expect(parent).toBe('viking://resources/docs/');
    });

    it('should return scope root for top-level path', () => {
      const parent = service.parentUri('viking://resources/file.md');
      expect(parent).toBe('viking://resources/');
    });

    it('should return undefined for scope root', () => {
      const parent = service.parentUri('viking://resources');
      expect(parent).toBeUndefined();
    });
  });

  describe('buildTree', () => {
    it('should build a tree from URIs', () => {
      const uris = [
        'viking://resources/docs/api.md',
        'viking://resources/docs/auth.md',
        'viking://resources/readme.md',
      ];

      const tree = service.buildTree(uris, 'viking://resources/', 2);
      expect(tree.name).toBe('resources');
      expect(tree.type).toBe('directory');
      expect(tree.children).toBeDefined();
    });
  });
});
