import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSchema1774000000001 implements MigrationInterface {
  name = 'CreateSchema1774000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Memories table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id VARCHAR PRIMARY KEY,
        text TEXT NOT NULL,
        type VARCHAR NOT NULL DEFAULT 'user',
        category VARCHAR NOT NULL DEFAULT 'general',
        agent_id VARCHAR,
        user_id VARCHAR,
        uri VARCHAR NOT NULL,
        l0_abstract TEXT,
        l1_overview TEXT,
        l2_content TEXT NOT NULL,
        embedding vector(768),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_uri ON memories(uri)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS memories_embedding_idx
      ON memories
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    // Resources table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id VARCHAR PRIMARY KEY,
        title VARCHAR DEFAULT '',
        uri VARCHAR NOT NULL,
        source_url VARCHAR,
        l0_abstract TEXT DEFAULT '',
        l1_overview TEXT DEFAULT '',
        l2_content TEXT NOT NULL DEFAULT '',
        embedding vector(768),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_resources_uri ON resources(uri)`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS resources_embedding_idx
      ON resources
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    // Skills table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS skills (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        uri VARCHAR NOT NULL,
        tags JSONB DEFAULT '[]'::jsonb,
        l0_abstract TEXT DEFAULT '',
        l1_overview TEXT DEFAULT '',
        l2_content TEXT NOT NULL DEFAULT '',
        embedding vector(768),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_skills_uri ON skills(uri)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS skills_embedding_idx
      ON skills
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    // Sessions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR PRIMARY KEY,
        agent_id VARCHAR,
        user_id VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
    );

    // Session messages table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS session_messages (
        id VARCHAR PRIMARY KEY,
        session_id VARCHAR NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role VARCHAR NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON session_messages(session_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS session_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS sessions`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_skills_name`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_skills_uri`);
    await queryRunner.query(`DROP INDEX IF EXISTS skills_embedding_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS skills`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_resources_uri`);
    await queryRunner.query(`DROP INDEX IF EXISTS resources_embedding_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS resources`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_memories_category`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_memories_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_memories_uri`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_memories_user_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_memories_agent_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS memories_embedding_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS memories`);
  }
}
