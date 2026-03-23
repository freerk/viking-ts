import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [SystemController],
})
export class SystemModule {}
