import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { HierarchicalRetrieverService } from './hierarchical-retriever.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService, HierarchicalRetrieverService],
  exports: [SearchService, HierarchicalRetrieverService],
})
export class SearchModule {}
