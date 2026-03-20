import { Module } from '@nestjs/common';
import { SkillService } from './skill.service';
import { SkillController } from './skill.controller';
import { VikingUriModule } from '../viking-uri/viking-uri.module';

@Module({
  imports: [VikingUriModule],
  providers: [SkillService],
  controllers: [SkillController],
  exports: [SkillService],
})
export class SkillModule {}
