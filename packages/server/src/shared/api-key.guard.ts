import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const EXEMPT_PATHS = new Set(['/health', '/api/v1/debug/health']);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private rootApiKey = '';

  constructor(private readonly config: ConfigService) {
    this.rootApiKey = this.config.get<string>('server.rootApiKey', '');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.rootApiKey) return true;

    const request = context.switchToHttp().getRequest<Request>();

    if (request.method === 'GET' && EXEMPT_PATHS.has(request.path)) {
      return true;
    }

    const provided = request.headers['x-api-key'];
    if (provided === this.rootApiKey) return true;

    throw new UnauthorizedException('Invalid or missing API key');
  }
}
