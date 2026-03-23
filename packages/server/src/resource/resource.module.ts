import { Module } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { ResourceController } from './resource.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [ResourceService],
  controllers: [ResourceController],
  exports: [ResourceService],
})
export class ResourceModule {}
