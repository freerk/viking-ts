import { IsString, IsOptional, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RelationsQueryDto {
  @ApiProperty({ description: 'Viking URI to get relations for' })
  @IsString()
  @MaxLength(500)
  uri!: string;
}

export class LinkDto {
  @ApiProperty({ description: 'Source Viking URI' })
  @IsString()
  @MaxLength(500)
  from_uri!: string;

  @ApiProperty({ description: 'Target Viking URIs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  to_uris!: string[];

  @ApiPropertyOptional({ description: 'Reason for the relation' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class UnlinkDto {
  @ApiProperty({ description: 'Source Viking URI' })
  @IsString()
  @MaxLength(500)
  from_uri!: string;

  @ApiProperty({ description: 'Target Viking URI' })
  @IsString()
  @MaxLength(500)
  to_uri!: string;
}
