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

    it('should return root with no children at depth 0', () => {
      const uris = ['viking://resources/doc.md'];
      const tree = service.buildTree(uris, 'viking://resources/', 0);
      expect(tree.children).toEqual([]);
    });

    it('should include direct children at depth 1', () => {
      const uris = [
        'viking://resources/doc.md',
        'viking://resources/nested/deep.md',
      ];
      const tree = service.buildTree(uris, 'viking://resources/', 1);
      expect(tree.children).toBeDefined();
      const names = tree.children?.map((c) => c.name) ?? [];
      expect(names).toContain('doc.md');
      expect(names).not.toContain('deep.md');
    });

    it('should return empty children for empty URI list', () => {
      const tree = service.buildTree([], 'viking://resources/', 2);
      expect(tree.children).toEqual([]);
    });

    it('should mark files as type file', () => {
      const uris = ['viking://resources/readme.md'];
      const tree = service.buildTree(uris, 'viking://resources/', 2);
      expect(tree.children?.[0]?.type).toBe('file');
    });
  });

  describe('edge cases', () => {
    it('should parse URI with deeply nested path', () => {
      const result = service.parse('viking://resources/a/b/c/d/e.md');
      expect(result.scope).toBe('resources');
      expect(result.path).toBe('a/b/c/d/e.md');
      expect(result.isDirectory).toBe(false);
    });

    it('should throw for empty string', () => {
      expect(() => service.parse('')).toThrow('Invalid Viking URI');
    });

    it('should build URI with single segment', () => {
      const uri = service.build('resources', 'file.md');
      expect(uri).toBe('viking://resources/file.md');
    });

    it('should return parent for nested directory URI', () => {
      const parent = service.parentUri('viking://resources/docs/api/');
      expect(parent).toBe('viking://resources/docs/');
    });

    it('should include fullPath in parsed result', () => {
      const result = service.parse('viking://user/memories/preferences/theme.md');
      expect(result.fullPath).toBe('user/memories/preferences/theme.md');
    });

    it('should strip trailing slash from fullPath', () => {
      const result = service.parse('viking://resources/docs/');
      expect(result.fullPath).toBe('resources/docs');
    });

    it('should build scope-only URI with no segments', () => {
      const uri = service.build('resources');
      expect(uri).toBe('viking://resources/');
    });

    it('should skip URIs outside the root prefix in buildTree', () => {
      const uris = [
        'viking://resources/doc.md',
        'viking://user/memories/note.md',
      ];
      const tree = service.buildTree(uris, 'viking://resources/', 2);
      const names = tree.children?.map((c) => c.name) ?? [];
      expect(names).toContain('doc.md');
      expect(names).not.toContain('note.md');
    });

    it('should skip URIs deeper than the specified depth in buildTree', () => {
      const uris = [
        'viking://resources/a.md',
        'viking://resources/deep/nested/file.md',
      ];
      const tree = service.buildTree(uris, 'viking://resources/', 1);
      const names = tree.children?.map((c) => c.name) ?? [];
      expect(names).toContain('a.md');
      // deep/nested/file.md has 3 segments, depth 1 only allows 1
      expect(names).not.toContain('file.md');
    });

    it('should handle URI that matches root prefix exactly in buildTree', () => {
      const uris = ['viking://resources/'];
      const tree = service.buildTree(uris, 'viking://resources/', 2);
      // URI matches root but has empty relativePath, should be skipped
      expect(tree.children).toEqual([]);
    });

    it('should use scope as name when path is empty in buildTree root', () => {
      const tree = service.buildTree([], 'viking://resources/', 2);
      expect(tree.name).toBe('resources');
    });

    it('should use last path segment as name when path is present in buildTree root', () => {
      const tree = service.buildTree([], 'viking://resources/docs/', 2);
      expect(tree.name).toBe('docs');
    });
  });
});
