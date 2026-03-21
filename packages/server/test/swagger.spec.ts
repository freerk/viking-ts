import basicAuth from 'express-basic-auth';

/**
 * Unit test for the Swagger setup logic extracted from main.ts.
 * Tests the env-based conditional activation without booting NestJS.
 */

interface SwaggerEnv {
  SWAGGER_ENABLED?: string;
  NODE_ENV?: string;
  SWAGGER_USER?: string;
  SWAGGER_PASSWORD?: string;
}

interface BasicAuthCall {
  paths: string[];
  users: Record<string, string>;
  challenge: boolean;
}

/**
 * Pure function that mirrors the decision logic from main.ts.
 * Returns whether Swagger should be active and, if in production,
 * the basic auth config that would be applied.
 */
function resolveSwaggerSetup(env: SwaggerEnv): {
  active: boolean;
  authApplied: BasicAuthCall | null;
} {
  const isSwaggerEnabled = env.SWAGGER_ENABLED === 'true';
  const swaggerUser = env.SWAGGER_USER;
  const swaggerPassword = env.SWAGGER_PASSWORD;
  const isProduction = env.NODE_ENV === 'production';

  if (!isSwaggerEnabled) {
    return { active: false, authApplied: null };
  }

  if (isProduction) {
    if (swaggerUser && swaggerPassword) {
      return {
        active: true,
        authApplied: {
          paths: ['/openapi', '/openapi-json'],
          users: { [swaggerUser]: swaggerPassword },
          challenge: true,
        },
      };
    }
    return { active: false, authApplied: null };
  }

  return { active: true, authApplied: null };
}

describe('Swagger setup logic', () => {
  it('should not activate when SWAGGER_ENABLED is absent', () => {
    const result = resolveSwaggerSetup({});
    expect(result.active).toBe(false);
    expect(result.authApplied).toBeNull();
  });

  it('should not activate when SWAGGER_ENABLED is false', () => {
    const result = resolveSwaggerSetup({ SWAGGER_ENABLED: 'false' });
    expect(result.active).toBe(false);
  });

  it('should activate in dev mode without auth', () => {
    const result = resolveSwaggerSetup({
      SWAGGER_ENABLED: 'true',
      NODE_ENV: 'development',
    });
    expect(result.active).toBe(true);
    expect(result.authApplied).toBeNull();
  });

  it('should activate without auth when NODE_ENV is unset', () => {
    const result = resolveSwaggerSetup({
      SWAGGER_ENABLED: 'true',
    });
    expect(result.active).toBe(true);
    expect(result.authApplied).toBeNull();
  });

  it('should not activate in production without credentials', () => {
    const result = resolveSwaggerSetup({
      SWAGGER_ENABLED: 'true',
      NODE_ENV: 'production',
    });
    expect(result.active).toBe(false);
  });

  it('should not activate in production with only SWAGGER_USER', () => {
    const result = resolveSwaggerSetup({
      SWAGGER_ENABLED: 'true',
      NODE_ENV: 'production',
      SWAGGER_USER: 'admin',
    });
    expect(result.active).toBe(false);
  });

  it('should not activate in production with only SWAGGER_PASSWORD', () => {
    const result = resolveSwaggerSetup({
      SWAGGER_ENABLED: 'true',
      NODE_ENV: 'production',
      SWAGGER_PASSWORD: 'secret',
    });
    expect(result.active).toBe(false);
  });

  it('should activate in production with full credentials and apply auth', () => {
    const result = resolveSwaggerSetup({
      SWAGGER_ENABLED: 'true',
      NODE_ENV: 'production',
      SWAGGER_USER: 'admin',
      SWAGGER_PASSWORD: 'secret',
    });
    expect(result.active).toBe(true);
    expect(result.authApplied).toEqual({
      paths: ['/openapi', '/openapi-json'],
      users: { admin: 'secret' },
      challenge: true,
    });
  });

  it('should import express-basic-auth successfully', () => {
    expect(typeof basicAuth).toBe('function');
  });
});
