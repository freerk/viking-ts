import { Module } from '@nestjs/common';
import { VikingUriService } from './viking-uri.service';
import { VikingUriController } from './viking-uri.controller';

@Module({
  providers: [VikingUriService],
  controllers: [VikingUriController],
  exports: [VikingUriService],
})
export class VikingUriModule {}
