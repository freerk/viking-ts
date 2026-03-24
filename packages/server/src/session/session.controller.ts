import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionService, MessagePart } from './session.service';
import { okResponse, errorResponse } from '../shared/api-response.helper';
import { ConflictError, NotFoundError } from '../shared/errors';
import { ApiResponse } from '../shared/types';
import { RequestContext } from '../shared/request-context';
import { VikingContext } from '../shared/request-context.interceptor';

interface AddMessageBody {
  role: string;
  content?: string;
  parts?: MessagePart[];
}

interface UsedBody {
  contexts?: string[];
  skill?: Record<string, unknown>;
}

@ApiTags('sessions')
@Controller('api/v1/sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new session' })
  async create(@VikingContext() ctx: RequestContext): Promise<ApiResponse<unknown>> {
    const session = await this.sessionService.create(ctx);
    return okResponse({
      session_id: session.session_id,
      user: {
        user_id: session.user_id,
        agent_id: session.agent_id,
      },
    });
  }

  @Get()
  @ApiOperation({ summary: 'List all sessions' })
  async list(): Promise<ApiResponse<unknown>> {
    const sessions = await this.sessionService.list();
    return okResponse(sessions);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get session details' })
  async get(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    try {
      const session = await this.sessionService.get(id);
      return okResponse({
        session_id: session.session_id,
        user: {
          user_id: session.user_id,
          agent_id: session.agent_id,
        },
        message_count: session.message_count,
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return errorResponse('NOT_FOUND', `Session ${id} not found`);
      }
      throw err;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a session' })
  async delete(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    try {
      await this.sessionService.delete(id);
      return okResponse({ session_id: id });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return errorResponse('NOT_FOUND', `Session ${id} not found`);
      }
      throw err;
    }
  }

  @Post(':id/commit')
  @ApiOperation({ summary: 'Commit a session (archive + extract memories)' })
  async commit(@Param('id') id: string, @VikingContext() ctx: RequestContext): Promise<ApiResponse<unknown>> {
    try {
      const result = await this.sessionService.commitAsync(id, ctx);
      return okResponse({
        session_id: result.session_id,
        status: result.status,
        task_id: result.task_id,
        message: 'Commit is processing in the background',
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return errorResponse('NOT_FOUND', `Session ${id} not found`);
      }
      if (err instanceof ConflictError) {
        return errorResponse('CONFLICT', String(err.message));
      }
      throw err;
    }
  }

  @Post(':id/extract')
  @ApiOperation({ summary: 'Extract memories from a session' })
  async extract(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    try {
      const memories = await this.sessionService.extract(id);
      return okResponse({ memories });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return errorResponse('NOT_FOUND', `Session ${id} not found`);
      }
      throw err;
    }
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Add a message to a session' })
  async addMessage(
    @Param('id') id: string,
    @Body() body: AddMessageBody,
  ): Promise<ApiResponse<unknown>> {
    try {
      const content = body.parts ?? body.content ?? '';
      const session = await this.sessionService.addMessage(id, body.role, content);
      return okResponse({
        session_id: session.session_id,
        message_count: session.message_count,
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return errorResponse('NOT_FOUND', `Session ${id} not found`);
      }
      throw err;
    }
  }

  @Post(':id/used')
  @ApiOperation({ summary: 'Record used contexts and skills' })
  async recordUsed(
    @Param('id') id: string,
    @Body() body: UsedBody,
  ): Promise<ApiResponse<unknown>> {
    try {
      const session = await this.sessionService.recordUsed(
        id,
        body.contexts,
        body.skill,
      );
      return okResponse({
        session_id: session.session_id,
        contexts_used: session.contexts_used,
        skills_used: session.skills_used,
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return errorResponse('NOT_FOUND', `Session ${id} not found`);
      }
      throw err;
    }
  }
}
