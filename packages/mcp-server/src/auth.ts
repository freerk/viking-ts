import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const BEARER_PREFIX = 'Bearer ';

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to burn constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function createBearerAuthMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    const token = authHeader.slice(BEARER_PREFIX.length);
    if (!timingSafeCompare(token, expectedToken)) {
      res.status(401).json({ error: 'Invalid bearer token' });
      return;
    }

    next();
  };
}
