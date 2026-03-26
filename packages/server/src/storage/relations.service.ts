import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { RelationEntity } from './entities';
import { InvalidUriError } from '../shared/errors';

export interface Relation {
  id: string;
  fromUri: string;
  toUri: string;
  reason: string;
  createdAt: string;
}

@Injectable()
export class RelationsService {

  constructor(
    @InjectRepository(RelationEntity)
    private readonly repo: Repository<RelationEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private validateUri(uri: string): void {
    if (!uri.startsWith('viking://')) {
      throw new InvalidUriError(uri);
    }
  }

  async getRelations(uri: string): Promise<Relation[]> {
    this.validateUri(uri);

    const entities = await this.repo.find({
      where: { fromUri: uri },
      order: { createdAt: 'ASC' },
    });

    return entities.map((e) => ({
      id: e.id,
      fromUri: e.fromUri,
      toUri: e.toUri,
      reason: e.reason,
      createdAt: e.createdAt,
    }));
  }

  async link(fromUri: string, toUris: string[], reason: string = ''): Promise<Relation[]> {
    this.validateUri(fromUri);
    for (const uri of toUris) {
      this.validateUri(uri);
    }

    const now = new Date().toISOString();
    const created: Relation[] = [];

    await this.dataSource.transaction(async (manager) => {
      const relationRepo = manager.getRepository(RelationEntity);
      for (const toUri of toUris) {
        const id = uuid();
        try {
          await relationRepo
            .createQueryBuilder()
            .insert()
            .values({ id, fromUri, toUri, reason, createdAt: now })
            .orIgnore()
            .execute();

          // Check if the row was actually inserted (orIgnore swallows conflicts)
          const exists = await relationRepo.findOneBy({ fromUri, toUri });
          if (exists && exists.id === id) {
            created.push({
              id,
              fromUri,
              toUri,
              reason,
              createdAt: now,
            });
          }
        } catch {
          // unique constraint violation — skip
        }
      }
    });

    return created;
  }

  async unlink(fromUri: string, toUri: string): Promise<boolean> {
    this.validateUri(fromUri);
    this.validateUri(toUri);

    const result = await this.repo.delete({ fromUri, toUri });
    return (result.affected ?? 0) > 0;
  }
}
