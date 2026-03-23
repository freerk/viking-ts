import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { HierarchicalRetrieverService } from './hierarchical-retriever.service';
import { IntentAnalyzerService } from './intent-analyzer.service';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [SearchController],
  providers: [SearchService, HierarchicalRetrieverService, IntentAnalyzerService],
  exports: [SearchService, HierarchicalRetrieverService],
})
export class SearchModule {}
