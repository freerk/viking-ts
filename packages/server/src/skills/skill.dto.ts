import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateSkillDto {
  @ApiProperty({ description: 'Skill name' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'Skill description' })
  @IsString()
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ description: 'Skill content (full SKILL.md text)', maxLength: 50000 })
  @IsString()
  @MaxLength(50000)
  content!: string;

  @ApiPropertyOptional({ description: 'Tags for categorization', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class AddSkillDto {
  @ApiPropertyOptional({ description: 'OpenViking data wrapper (skill dict or MCP tool)' })
  @IsOptional()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Skill name (legacy direct shape)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Skill description (legacy direct shape)' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Skill content (legacy direct shape)' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: 'Tags for categorization (legacy direct shape)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class SearchSkillsQueryDto {
  @ApiProperty({ description: 'Search query' })
  @IsString()
  @MaxLength(2000)
  q!: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0.01 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  scoreThreshold?: number;
}

export class ListSkillsQueryDto {
  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: 'Filter by tag' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tag?: string;
}
