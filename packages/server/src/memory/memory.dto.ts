import { IsString, IsOptional, IsEnum, MaxLength, IsNumber, Min, Max, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateMemoryDto {
  @ApiProperty({ description: 'Memory text content', maxLength: 50000 })
  @IsString()
  @MaxLength(50000)
  text!: string;

  @ApiPropertyOptional({ enum: ['user', 'agent'], default: 'user' })
  @IsOptional()
  @IsEnum(['user', 'agent'])
  type?: 'user' | 'agent';

  @ApiPropertyOptional({
    enum: ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns', 'general'],
    default: 'general',
  })
  @IsOptional()
  @IsEnum(['profile', 'preferences', 'entities', 'events', 'cases', 'patterns', 'general'])
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  agentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userId?: string;

  @ApiPropertyOptional({ description: 'Custom Viking URI' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  uri?: string;
}

export class SearchMemoriesQueryDto {
  @ApiProperty({ description: 'Search query' })
  @IsString()
  @MaxLength(2000)
  q!: string;

  @ApiPropertyOptional({ default: 6 })
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

  @ApiPropertyOptional({ description: 'Filter by Viking URI prefix' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  uri?: string;
}

export class ListMemoriesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ enum: ['user', 'agent'] })
  @IsOptional()
  @IsEnum(['user', 'agent'])
  type?: 'user' | 'agent';

  @ApiPropertyOptional({
    enum: ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns', 'general'],
  })
  @IsOptional()
  @IsEnum(['profile', 'preferences', 'entities', 'events', 'cases', 'patterns', 'general'])
  category?: string;

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
}

export class CaptureSessionDto {
  @ApiProperty({ description: 'Conversation messages to capture' })
  @IsArray()
  messages!: Array<{ role: string; content: string }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}
