import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TaskTrackerService } from './task-tracker.service';
import { okResponse, errorResponse } from '../shared/api-response.helper';

@ApiTags('tasks')
@Controller('api/v1/tasks')
export class TasksController {
  constructor(private readonly taskTracker: TaskTrackerService) {}

  @Get(':task_id')
  @ApiOperation({ summary: 'Get task status by ID' })
  getTask(@Param('task_id') taskId: string) {
    const task = this.taskTracker.get(taskId);
    if (!task) {
      throw new HttpException(
        errorResponse('NOT_FOUND', `Task ${taskId} not found`),
        HttpStatus.NOT_FOUND,
      );
    }
    return okResponse(task);
  }

  @Get()
  @ApiOperation({ summary: 'List tasks with optional filters' })
  listTasks(
    @Query('task_type') taskType?: string,
    @Query('status') status?: string,
    @Query('resource_id') resourceId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const tasks = this.taskTracker.list({
      taskType,
      status,
      resourceId,
      limit: parsedLimit,
    });
    return okResponse(tasks);
  }
}
