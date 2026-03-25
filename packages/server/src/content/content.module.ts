import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [ContentController],
})
export class ContentModule {}
