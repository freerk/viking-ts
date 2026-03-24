import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PackService } from './pack.service';
import { ExportDto, ImportDto } from './pack.dto';
import { okResponse, errorResponse } from '../shared/api-response.helper';
import { ApiResponse } from '../shared/types';
import { VikingError } from '../shared/errors';

@ApiTags('pack')
@Controller('api/v1/pack')
export class PackController {
  constructor(private readonly packService: PackService) {}

  @Post('export')
  @ApiOperation({ summary: 'Export a VFS subtree to an .ovpack file' })
  async export(
    @Body() body: ExportDto,
  ): Promise<ApiResponse<{ file: string }>> {
    const startTime = Date.now();
    try {
      const file = await this.packService.exportOvpack(body.uri, body.to);
      return okResponse({ file }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Post('import')
  @ApiOperation({ summary: 'Import an .ovpack file into VFS' })
  async import(
    @Body() body: ImportDto,
  ): Promise<ApiResponse<{ uri: string }>> {
    const startTime = Date.now();
    try {
      const filePath = body.temp_path ?? body.file_path;
      if (!filePath) {
        throw new HttpException(
          errorResponse('BAD_REQUEST', 'Either file_path or temp_path is required'),
          HttpStatus.BAD_REQUEST,
        );
      }
      const uri = await this.packService.importOvpack(
        filePath,
        body.parent,
        body.force ?? false,
        body.vectorize ?? false,
      );
      return okResponse({ uri }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }
}

function toHttpException(err: unknown): HttpException {
  if (err instanceof HttpException) {
    return err;
  }
  if (err instanceof VikingError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: HttpStatus.NOT_FOUND,
      CONFLICT: HttpStatus.CONFLICT,
      INVALID_URI: HttpStatus.BAD_REQUEST,
    };
    const status = statusMap[err.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    return new HttpException(errorResponse(err.code, err.message), status);
  }
  if (err instanceof Error && err.message.startsWith('File not found:')) {
    return new HttpException(
      errorResponse('BAD_REQUEST', err.message),
      HttpStatus.BAD_REQUEST,
    );
  }
  if (err instanceof Error && err.message.startsWith('Unsafe path:')) {
    return new HttpException(
      errorResponse('BAD_REQUEST', err.message),
      HttpStatus.BAD_REQUEST,
    );
  }
  return new HttpException(
    errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'),
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
