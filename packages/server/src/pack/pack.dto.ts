import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExportDto {
  @ApiProperty({ description: 'Viking URI to export' })
  @IsString()
  @MaxLength(2000)
  uri!: string;

  @ApiProperty({ description: 'Local file path for the .ovpack output' })
  @IsString()
  @MaxLength(2000)
  to!: string;
}

export class ImportDto {
  @ApiPropertyOptional({ description: 'Path to the .ovpack file' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  file_path?: string;

  @ApiPropertyOptional({ description: 'Temporary path to the uploaded .ovpack file' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  temp_path?: string;

  @ApiProperty({ description: 'Parent Viking URI to import under' })
  @IsString()
  @MaxLength(2000)
  parent!: string;

  @ApiPropertyOptional({ description: 'Overwrite existing URI (default: false)' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({ description: 'Enqueue imported files for embedding (default: false)' })
  @IsOptional()
  @IsBoolean()
  vectorize?: boolean;
}
