import { Module, Global } from '@nestjs/common';
import { VectorStoreService } from './vector-store.service';
import { MetadataStoreService } from './metadata-store.service';

@Global()
@Module({
  providers: [VectorStoreService, MetadataStoreService],
  exports: [VectorStoreService, MetadataStoreService],
})
export class StorageModule {}
