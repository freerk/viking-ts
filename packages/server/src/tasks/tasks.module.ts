import { Module, Global } from '@nestjs/common';
import { TaskTrackerService } from './task-tracker.service';
import { TasksController } from './tasks.controller';

@Global()
@Module({
  providers: [TaskTrackerService],
  controllers: [TasksController],
  exports: [TaskTrackerService],
})
export class TasksModule {}
