# PostgreSQL + pgvector Setup

This guide covers setting up PostgreSQL with pgvector for use as the viking-ts storage backend.

## 1. Install PostgreSQL and pgvector

### macOS (Homebrew)

```bash
brew install postgresql@16
brew install pgvector
```

### Ubuntu/Debian

```bash
sudo apt install postgresql postgresql-contrib
sudo apt install postgresql-16-pgvector
```

### Docker

```bash
docker run -d \
  --name viking-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

When using the Docker image, pgvector is pre-installed. Skip to step 3.

## 2. Install the pgvector extension

Connect to PostgreSQL and enable the extension:

```bash
psql -U postgres
```

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 3. Create the database and user

```sql
-- Create a dedicated database
CREATE DATABASE viking_ts;

-- Create a role with login credentials
CREATE ROLE viking WITH LOGIN PASSWORD 'your_secure_password';

-- Grant access
ALTER DATABASE viking_ts OWNER TO viking;
\c viking_ts
GRANT ALL PRIVILEGES ON DATABASE viking_ts TO viking;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO viking;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO viking;
```

Enable pgvector in the new database:

```sql
-- Still connected to viking_ts
CREATE EXTENSION IF NOT EXISTS vector;
```

Verify the setup:

```sql
\du   -- list roles
\l    -- list databases
\dx   -- list extensions (should show "vector")
```

## 4. Configure viking-ts

Set the following in your `.env` file (see `.env.example`):

```env
STORAGE_BACKEND=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=viking
DB_PASSWORD=your_secure_password
DB_DATABASE=viking_ts
```

## 5. Run migrations

The migrations create all required tables and indexes (including IVFFLAT vector indexes):

```bash
cd packages/server
npm run migration:run
```

To check migration status or revert:

```bash
npm run migration:revert
```

## Notes

- The migrations automatically create the pgvector extension (`CREATE EXTENSION IF NOT EXISTS vector`), but the database user needs the `CREATE` privilege on the database for this to succeed. Alternatively, install the extension manually as a superuser (step 2/3 above).
- Vector columns use 768 dimensions with IVFFLAT indexes (100 lists) for cosine similarity search.
- Set `DB_LOGGING=true` in your `.env` to see TypeORM SQL queries in the server logs.
