import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  createParamDecorator,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { UserIdentifier, RequestContext } from './request-context';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    const accountId = this.headerString(request, 'x-openviking-account') ?? 'default';
    const userId = this.headerString(request, 'x-openviking-user') ?? 'default';
    const agentId = this.headerString(request, 'x-openviking-agent') ?? 'default';

    const vikingCtx: RequestContext = {
      user: new UserIdentifier(accountId, userId, agentId),
    };

    (request as unknown as Record<string, unknown>)['vikingCtx'] = vikingCtx;

    return next.handle();
  }

  private headerString(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return undefined;
  }
}

export const VikingContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // Property attached by RequestContextInterceptor
    return (request as unknown as Record<string, unknown>)['vikingCtx'] as RequestContext;
  },
);
