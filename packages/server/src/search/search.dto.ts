import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class FindRequestDto {
  @ApiProperty({ description: 'Search query text', maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  query!: string;

  @ApiPropertyOptional({ description: 'Restrict search to subtree URI' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  target_uri?: string;

  @ApiPropertyOptional({ description: 'Max results to return', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Minimum score threshold' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  score_threshold?: number;

  @ApiPropertyOptional({ description: 'Additional filter constraints' })
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Include telemetry data in response' })
  @IsOptional()
  @IsBoolean()
  telemetry?: boolean;
}

export class SearchRequestDto {
  @ApiProperty({ description: 'Search query text', maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  query!: string;

  @ApiPropertyOptional({ description: 'Restrict search to subtree URI' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  target_uri?: string;

  @ApiPropertyOptional({ description: 'Boost memories from this session' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  session_id?: string;

  @ApiPropertyOptional({ description: 'Max results to return', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Minimum score threshold' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  score_threshold?: number;

  @ApiPropertyOptional({ description: 'Additional filter constraints' })
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;
}

export class GrepRequestDto {
  @ApiProperty({ description: 'Root URI to search under' })
  @IsString()
  @MaxLength(500)
  uri!: string;

  @ApiProperty({ description: 'Regex or literal pattern to match' })
  @IsString()
  @MaxLength(1000)
  pattern!: string;

  @ApiPropertyOptional({ description: 'Case insensitive matching' })
  @IsOptional()
  @IsBoolean()
  case_insensitive?: boolean;

  @ApiPropertyOptional({ description: 'Max number of matching nodes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10000)
  node_limit?: number;
}

export class GlobRequestDto {
  @ApiProperty({ description: 'Glob pattern e.g. "viking://user/*/memories/*.md"' })
  @IsString()
  @MaxLength(1000)
  pattern!: string;

  @ApiPropertyOptional({ description: 'Root URI to scope search' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  uri?: string;

  @ApiPropertyOptional({ description: 'Max number of matching nodes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10000)
  node_limit?: number;
}

export interface MatchedContextResponse {
  uri: string;
  parent_uri: string;
  context_type: string;
  level: number;
  abstract: string;
  name: string;
  description: string;
  tags: string;
  score: number;
  active_count: number;
  created_at: string;
  updated_at: string;
}

export interface GrepMatch {
  uri: string;
  line_number: number;
  line: string;
  context_before: string[];
  context_after: string[];
}
