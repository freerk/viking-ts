import { IsString, IsOptional, MaxLength, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateResourceDto {
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
