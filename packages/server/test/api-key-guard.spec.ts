import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from '../src/shared/api-key.guard';

function createMockContext(path: string, method: string, apiKey?: string): ExecutionContext {
  const request = {
    path,
    method,
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function createGuard(rootApiKey: string): ApiKeyGuard {
  const config = {
    get: (key: string, defaultVal: unknown) => {
      if (key === 'server.rootApiKey') return rootApiKey;
      return defaultVal;
    },
  } as ConfigService;

  return new ApiKeyGuard(config);
}

describe('ApiKeyGuard', () => {
  it('should allow all requests when rootApiKey is empty', () => {
    const guard = createGuard('');
    const ctx = createMockContext('/api/v1/memories', 'GET');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should reject requests without X-API-Key header when rootApiKey is set', () => {
    const guard = createGuard('secret-123');
    const ctx = createMockContext('/api/v1/memories', 'GET');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should reject requests with wrong API key', () => {
    const guard = createGuard('secret-123');
    const ctx = createMockContext('/api/v1/memories', 'GET', 'wrong-key');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should allow requests with correct API key', () => {
    const guard = createGuard('secret-123');
    const ctx = createMockContext('/api/v1/memories', 'GET', 'secret-123');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should exempt GET /health from auth', () => {
    const guard = createGuard('secret-123');
    const ctx = createMockContext('/health', 'GET');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should exempt GET /api/v1/debug/health from auth', () => {
    const guard = createGuard('secret-123');
    const ctx = createMockContext('/api/v1/debug/health', 'GET');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should not exempt POST /health from auth', () => {
    const guard = createGuard('secret-123');
    const ctx = createMockContext('/health', 'POST');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
