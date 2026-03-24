import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkillService } from './skill.service';
import {
  AddSkillDto,
  SearchSkillsQueryDto,
  ListSkillsQueryDto,
} from './skill.dto';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, SkillRecord, SearchResult } from '../shared/types';
import { isMcpFormat, mcpToSkill, McpToolInput } from './mcp-converter';

@ApiTags('skills')
@Controller('api/v1/skills')
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new skill' })
  async create(@Body() dto: AddSkillDto): Promise<ApiResponse<SkillRecord>> {
    const startTime = Date.now();

    let skillInput: { name: string; description: string; content: string; tags?: string[] };

    if (dto.data !== undefined) {
      if (isMcpFormat(dto.data)) {
        skillInput = mcpToSkill(dto.data as McpToolInput);
      } else {
        const d = dto.data as Record<string, unknown>;
        skillInput = {
          name: d.name as string,
          description: (d.description as string) ?? '',
          content: (d.content as string) ?? '',
          tags: d.tags as string[] | undefined,
        };
      }
    } else if (dto.name && dto.content) {
      skillInput = {
        name: dto.name,
        description: dto.description ?? '',
        content: dto.content,
        tags: dto.tags,
      };
    } else {
      throw new BadRequestException('Either data or name+content is required');
    }

    const skill = await this.skillService.createSkill(skillInput);
    return okResponse(skill, startTime);
  }

  @Get('search')
  @ApiOperation({ summary: 'Semantic search over skills' })
  async search(@Query() query: SearchSkillsQueryDto): Promise<ApiResponse<SearchResult[]>> {
    const startTime = Date.now();
    const results = await this.skillService.searchSkills(
      query.q,
      query.limit ?? 10,
      query.scoreThreshold ?? 0.01,
    );
    return okResponse(results, startTime);
  }

  @Get()
  @ApiOperation({ summary: 'List all skills' })
  async list(@Query() query: ListSkillsQueryDto): Promise<ApiResponse<SkillRecord[]>> {
    const startTime = Date.now();
    const skills = await this.skillService.listSkills(
      query.limit ?? 100,
      query.offset ?? 0,
      query.tag,
    );
    return okResponse(skills, startTime);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific skill' })
  async get(@Param('id') id: string): Promise<ApiResponse<SkillRecord>> {
    const startTime = Date.now();
    const skill = await this.skillService.getSkill(id);
    return okResponse(skill, startTime);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a skill' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.skillService.deleteSkill(id);
  }
}
