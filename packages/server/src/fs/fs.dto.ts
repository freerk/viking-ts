import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class MkdirDto {
  @ApiProperty({ description: 'Viking URI for the directory to create' })
  @IsString()
  @MaxLength(500)
  uri!: string;
}

export class MvDto {
  @ApiProperty({ description: 'Source Viking URI' })
  @IsString()
  @MaxLength(500)
  from_uri!: string;

  @ApiProperty({ description: 'Destination Viking URI' })
  @IsString()
  @MaxLength(500)
  to_uri!: string;
}

export class LsQueryDto {
  @ApiProperty({ description: 'Viking URI to list' })
  @IsString()
  @MaxLength(500)
  uri!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  simple?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  recursive?: boolean;

  @ApiPropertyOptional({ enum: ['original', 'agent'] })
  @IsOptional()
  @IsString()
  output?: 'original' | 'agent';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  abs_limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  show_all_hidden?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  node_limit?: number;
}

export class TreeQueryDto {
  @ApiProperty({ description: 'Viking URI root for tree' })
  @IsString()
  @MaxLength(500)
  uri!: string;

  @ApiPropertyOptional({ enum: ['original', 'agent'] })
  @IsOptional()
  @IsString()
  output?: 'original' | 'agent';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  abs_limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  show_all_hidden?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  node_limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  level_limit?: number;
}

export class StatQueryDto {
  @ApiProperty({ description: 'Viking URI to stat' })
  @IsString()
  @MaxLength(500)
  uri!: string;
}

export class DeleteFsQueryDto {
  @ApiProperty({ description: 'Viking URI to delete' })
  @IsString()
  @MaxLength(500)
  uri!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  recursive?: boolean;
}
