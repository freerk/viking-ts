import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { VfsService } from './vfs.service';
import { ContextVectorService } from './context-vector.service';
import { RelationsService } from './relations.service';

@Global()
@Module({
  providers: [DatabaseService, VfsService, ContextVectorService, RelationsService],
  exports: [DatabaseService, VfsService, ContextVectorService, RelationsService],
})
export class StorageModule {}
