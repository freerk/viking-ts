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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkillService } from './skill.service';
import {
  CreateSkillDto,
  SearchSkillsQueryDto,
  ListSkillsQueryDto,
} from './skill.dto';
import { okResponse } from '../shared/api-response.helper';
import { ApiResponse, SkillRecord, SearchResult } from '../shared/types';

@ApiTags('skills')
@Controller('api/v1/skills')
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new skill' })
  async create(@Body() dto: CreateSkillDto): Promise<ApiResponse<SkillRecord>> {
    const startTime = Date.now();
    const skill = await this.skillService.createSkill({
      name: dto.name,
      description: dto.description,
      content: dto.content,
      tags: dto.tags,
    });
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
  list(@Query() query: ListSkillsQueryDto): ApiResponse<SkillRecord[]> {
    const startTime = Date.now();
    const skills = this.skillService.listSkills(
      query.limit ?? 100,
      query.offset ?? 0,
      query.tag,
    );
    return okResponse(skills, startTime);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific skill' })
  get(@Param('id') id: string): ApiResponse<SkillRecord> {
    const startTime = Date.now();
    const skill = this.skillService.getSkill(id);
    return okResponse(skill, startTime);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a skill' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.skillService.deleteSkill(id);
  }
}
