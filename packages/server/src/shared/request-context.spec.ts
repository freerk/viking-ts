import { createHash } from 'crypto';
import { UserIdentifier } from './request-context';

describe('UserIdentifier', () => {
  describe('userSpaceName', () => {
    it('should return the userId directly', () => {
      const id = new UserIdentifier('acme', 'freerk', 'simon');
      expect(id.userSpaceName()).toBe('freerk');
    });

    it('should return "default" for default identifier', () => {
      const id = UserIdentifier.default();
      expect(id.userSpaceName()).toBe('default');
    });
  });

  describe('agentSpaceName', () => {
    it('should return first 12 chars of md5(userId:agentId)', () => {
      const id = new UserIdentifier('acme', 'freerk', 'simon');
      const expected = createHash('md5')
        .update('freerk:simon')
        .digest('hex')
        .slice(0, 12);

      expect(id.agentSpaceName()).toBe(expected);
      expect(id.agentSpaceName()).toHaveLength(12);
    });

    it('should produce consistent hashes', () => {
      const a = new UserIdentifier('x', 'freerk', 'simon');
      const b = new UserIdentifier('y', 'freerk', 'simon');
      expect(a.agentSpaceName()).toBe(b.agentSpaceName());
    });

    it('should produce different hashes for different userId:agentId pairs', () => {
      const a = new UserIdentifier('default', 'freerk', 'simon');
      const b = new UserIdentifier('default', 'freerk', 'other');
      expect(a.agentSpaceName()).not.toBe(b.agentSpaceName());
    });

    it('should produce a valid hex string for default values', () => {
      const id = UserIdentifier.default();
      expect(id.agentSpaceName()).toMatch(/^[0-9a-f]{12}$/);
    });
  });

  describe('default', () => {
    it('should create identifier with all "default" values', () => {
      const id = UserIdentifier.default();
      expect(id.accountId).toBe('default');
      expect(id.userId).toBe('default');
      expect(id.agentId).toBe('default');
    });
  });
});
