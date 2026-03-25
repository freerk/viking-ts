import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class ReadContentQueryDto {
  @ApiProperty({ description: 'Viking URI to read' })
  @IsString()
  @MaxLength(500)
  uri!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  offset?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class AbstractQueryDto {
  @ApiProperty({ description: 'Viking URI for which to read abstract' })
  @IsString()
  @MaxLength(500)
  uri!: string;
}

export class OverviewQueryDto {
  @ApiProperty({ description: 'Viking URI for which to read overview' })
  @IsString()
  @MaxLength(500)
  uri!: string;
}

export class DownloadQueryDto {
  @ApiProperty({ description: 'Viking URI to download' })
  @IsString()
  @MaxLength(500)
  uri!: string;
}

export class ReindexDto {
  @ApiProperty({ description: 'Viking URI to reindex' })
  @IsString()
  @MaxLength(500)
  uri!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  regenerate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  wait?: boolean;
}
