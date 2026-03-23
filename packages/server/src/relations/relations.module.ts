import { Module } from '@nestjs/common';
import { RelationsController } from './relations.controller';

@Module({
  controllers: [RelationsController],
})
export class RelationsModule {}
