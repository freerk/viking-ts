import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitPgvector1774000000000 implements MigrationInterface {
  name = 'InitPgvector1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  }

  public async down(): Promise<void> {
    // pgvector extension is shared, do not drop it
  }
}
