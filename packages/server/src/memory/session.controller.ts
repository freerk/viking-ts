import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MemoryService } from './memory.service';
import { CaptureSessionDto } from './memory.dto';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, MemoryRecord } from '../shared/types';

@ApiTags('sessions')
@Controller('api/v1/sessions')
export class SessionController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post('capture')
  @ApiOperation({ summary: 'Ingest conversation JSON and extract memories via LLM' })
  async capture(@Body() dto: CaptureSessionDto): Promise<ApiResponse<{ memoriesExtracted: number; memories: MemoryRecord[] }>> {
    const startTime = Date.now();
    const memories = await this.memoryService.captureSession(
      dto.messages,
      dto.agentId,
      dto.userId,
      dto.accountId,
    );
    return okResponse(
      { memoriesExtracted: memories.length, memories },
      startTime,
    );
  }
}
