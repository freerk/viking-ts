import type { Request, Response, NextFunction } from 'express';
import { createBearerAuthMiddleware } from './auth';

function mockReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  };
}

function mockRes(): Partial<Response> & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Partial<Response> & { statusCode: number; body: unknown };
}

const TOKEN = 'test-secret-token-abc123';

describe('createBearerAuthMiddleware', () => {
  const middleware = createBearerAuthMiddleware(TOKEN);

  it('should call next() for a valid bearer token', () => {
    const req = mockReq(`Bearer ${TOKEN}`);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    middleware(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('should return 401 when Authorization header is missing', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    middleware(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or malformed Authorization header' });
  });

  it('should return 401 when Authorization header has wrong scheme', () => {
    const req = mockReq('Basic dXNlcjpwYXNz');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    middleware(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or malformed Authorization header' });
  });

  it('should return 401 when token is invalid', () => {
    const req = mockReq('Bearer wrong-token');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    middleware(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid bearer token' });
  });

  it('should return 401 when token is empty', () => {
    const req = mockReq('Bearer ');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    middleware(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid bearer token' });
  });
});
