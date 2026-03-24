import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { RequestContextInterceptor } from './request-context.interceptor';
import { RequestContext } from './request-context';

function createMockContext(headers: Record<string, string> = {}): {
  executionContext: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = {
    headers: { ...headers },
  };

  const executionContext = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { executionContext, request };
}

describe('RequestContextInterceptor', () => {
  let interceptor: RequestContextInterceptor;
  const nextHandler: CallHandler = { handle: () => of('result') };

  beforeEach(() => {
    interceptor = new RequestContextInterceptor();
  });

  it('should set default values when no headers are present', (done) => {
    const { executionContext, request } = createMockContext();

    interceptor.intercept(executionContext, nextHandler).subscribe(() => {
      const ctx = request['vikingCtx'] as RequestContext;
      expect(ctx.user.accountId).toBe('default');
      expect(ctx.user.userId).toBe('default');
      expect(ctx.user.agentId).toBe('default');
      done();
    });
  });

  it('should extract identity from X-OpenViking headers', (done) => {
    const { executionContext, request } = createMockContext({
      'x-openviking-account': 'acme',
      'x-openviking-user': 'freerk',
      'x-openviking-agent': 'simon',
    });

    interceptor.intercept(executionContext, nextHandler).subscribe(() => {
      const ctx = request['vikingCtx'] as RequestContext;
      expect(ctx.user.accountId).toBe('acme');
      expect(ctx.user.userId).toBe('freerk');
      expect(ctx.user.agentId).toBe('simon');
      done();
    });
  });

  it('should fall back to "default" for missing headers', (done) => {
    const { executionContext, request } = createMockContext({
      'x-openviking-user': 'freerk',
    });

    interceptor.intercept(executionContext, nextHandler).subscribe(() => {
      const ctx = request['vikingCtx'] as RequestContext;
      expect(ctx.user.accountId).toBe('default');
      expect(ctx.user.userId).toBe('freerk');
      expect(ctx.user.agentId).toBe('default');
      done();
    });
  });

  it('should ignore empty header values', (done) => {
    const { executionContext, request } = createMockContext({
      'x-openviking-user': '',
      'x-openviking-agent': 'simon',
    });

    interceptor.intercept(executionContext, nextHandler).subscribe(() => {
      const ctx = request['vikingCtx'] as RequestContext;
      expect(ctx.user.userId).toBe('default');
      expect(ctx.user.agentId).toBe('simon');
      done();
    });
  });

  it('should produce correct agentSpaceName hash for alice:bob', (done) => {
    const { createHash } = require('crypto');
    const expectedHash = createHash('md5').update('alice:bob').digest('hex').slice(0, 12);

    const { executionContext, request } = createMockContext({
      'x-openviking-user': 'alice',
      'x-openviking-agent': 'bob',
    });

    interceptor.intercept(executionContext, nextHandler).subscribe(() => {
      const ctx = request['vikingCtx'] as RequestContext;
      expect(ctx.user.userId).toBe('alice');
      expect(ctx.user.agentId).toBe('bob');
      expect(ctx.user.agentSpaceName()).toBe(expectedHash);
      expect(ctx.user.agentSpaceName()).toHaveLength(12);
      done();
    });
  });
});
