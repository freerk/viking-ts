import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RelationsService, Relation } from '../storage/relations.service';
import { okResponse, errorResponse } from '../shared/api-response.helper';
import { ApiResponse } from '../shared/types';
import { VikingError } from '../shared/errors';
import { RelationsQueryDto, LinkDto, UnlinkDto } from './relations.dto';

@ApiTags('relations')
@Controller('api/v1/relations')
export class RelationsController {
  constructor(private readonly relations: RelationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get relations for a URI' })
  async getRelations(@Query() query: RelationsQueryDto): Promise<ApiResponse<Relation[]>> {
    const startTime = Date.now();
    try {
      const rels = await this.relations.getRelations(query.uri);
      return okResponse(rels, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Post('link')
  @ApiOperation({ summary: 'Create relations between URIs' })
  async link(@Body() dto: LinkDto): Promise<ApiResponse<Relation[]>> {
    const startTime = Date.now();
    try {
      const created = await this.relations.link(dto.from_uri, dto.to_uris, dto.reason);
      return okResponse(created, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Delete('link')
  @ApiOperation({ summary: 'Remove a relation between URIs' })
  async unlink(@Body() dto: UnlinkDto): Promise<ApiResponse<{ deleted: boolean }>> {
    const startTime = Date.now();
    try {
      const deleted = await this.relations.unlink(dto.from_uri, dto.to_uri);
      return okResponse({ deleted }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }
}

function toHttpException(err: unknown): HttpException {
  if (err instanceof VikingError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: HttpStatus.NOT_FOUND,
      CONFLICT: HttpStatus.CONFLICT,
      INVALID_URI: HttpStatus.BAD_REQUEST,
    };
    const status = statusMap[err.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    return new HttpException(
      errorResponse(err.code, err.message),
      status,
    );
  }
  if (err instanceof HttpException) {
    return err;
  }
  return new HttpException(
    errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'),
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
