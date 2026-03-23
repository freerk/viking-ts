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
import { VfsService, VfsEntry, TreeNode } from '../storage/vfs.service';
import { okResponse, errorResponse } from '../shared/api-response.helper';
import { ApiResponse } from '../shared/types';
import { VikingError } from '../shared/errors';
import {
  MkdirDto,
  MvDto,
  LsQueryDto,
  TreeQueryDto,
  StatQueryDto,
  DeleteFsQueryDto,
} from './fs.dto';

@ApiTags('filesystem')
@Controller('api/v1/fs')
export class FsController {
  constructor(private readonly vfs: VfsService) {}

  @Get('ls')
  @ApiOperation({ summary: 'List contents at a Viking URI' })
  async ls(@Query() query: LsQueryDto): Promise<ApiResponse<VfsEntry[]>> {
    const startTime = Date.now();
    try {
      const entries = await this.vfs.ls(query.uri, {
        simple: query.simple,
        recursive: query.recursive,
        output: query.output,
        absLimit: query.abs_limit,
        showAllHidden: query.show_all_hidden,
        nodeLimit: query.node_limit,
      });
      return okResponse(entries, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Get('tree')
  @ApiOperation({ summary: 'Tree view of a Viking URI' })
  async tree(@Query() query: TreeQueryDto): Promise<ApiResponse<TreeNode>> {
    const startTime = Date.now();
    try {
      const tree = await this.vfs.tree(query.uri, {
        output: query.output,
        absLimit: query.abs_limit,
        showAllHidden: query.show_all_hidden,
        nodeLimit: query.node_limit,
        levelLimit: query.level_limit,
      });
      return okResponse(tree, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Get('stat')
  @ApiOperation({ summary: 'Get file/directory info' })
  async stat(@Query() query: StatQueryDto): Promise<ApiResponse<VfsEntry>> {
    const startTime = Date.now();
    try {
      const entry = await this.vfs.stat(query.uri);
      return okResponse(entry, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Post('mkdir')
  @ApiOperation({ summary: 'Create a directory' })
  async mkdir(@Body() dto: MkdirDto): Promise<ApiResponse<VfsEntry>> {
    const startTime = Date.now();
    try {
      const entry = await this.vfs.mkdir(dto.uri);
      return okResponse(entry, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Delete()
  @ApiOperation({ summary: 'Delete a file or directory' })
  async remove(@Query() query: DeleteFsQueryDto): Promise<ApiResponse<{ deleted: boolean }>> {
    const startTime = Date.now();
    try {
      await this.vfs.rm(query.uri, query.recursive);
      return okResponse({ deleted: true }, startTime);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  @Post('mv')
  @ApiOperation({ summary: 'Move/rename a file or directory' })
  async mv(@Body() dto: MvDto): Promise<ApiResponse<{ moved: boolean }>> {
    const startTime = Date.now();
    try {
      await this.vfs.mv(dto.from_uri, dto.to_uri);
      return okResponse({ moved: true }, startTime);
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
