import { IsString, IsOptional, IsBoolean, MaxLength, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AddResourceDto {
  @ApiPropertyOptional({ description: 'Local file path, directory path, or URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  path?: string;

  @ApiPropertyOptional({ description: 'Raw text/markdown content' })
  @IsOptional()
  @IsString()
  @MaxLength(500000)
  text?: string;

  @ApiPropertyOptional({ description: 'Target Viking URI (must be viking://resources/...)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  to?: string;

  @ApiPropertyOptional({ description: 'Parent URI (mutually exclusive with to)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  parent?: string;

  @ApiPropertyOptional({ description: 'Why being added (used in L0/L1 generation context)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Processing hints' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instruction?: string;

  @ApiPropertyOptional({ description: 'Block until vectorized (default: false)' })
  @IsOptional()
  @IsBoolean()
  wait?: boolean;

  @ApiPropertyOptional({ description: 'Optional title (backward compat)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Direct URI override (backward compat)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  uri?: string;
}

export class CreateResourceDto {
  @ApiPropertyOptional({
    description: 'Custom Viking URI, e.g. viking://resources/whisperline/principles.md',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  uri?: string;

  @ApiPropertyOptional({ description: 'Resource title' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ description: 'Resource text content', maxLength: 50000 })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  text?: string;

  @ApiPropertyOptional({ description: 'Source URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;
}

export class SearchResourcesQueryDto {
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
