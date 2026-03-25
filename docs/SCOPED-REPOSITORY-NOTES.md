# typeorm-scoped-repository Integration Notes

## What the package does

[typeorm-scoped-repository](https://github.com/freerk/typeorm-scoped-repository) (v0.1.2) wraps TypeORM's `Repository<T>` with automatic multi-scope isolation. Every `find`, `findOne`, `save`, `update`, `delete`, and `createQueryBuilder` call gets scope fields injected as WHERE conditions automatically.

Key features:
- **Fortress pattern**: `.where()` silently converts to `.andWhere()` on query builders, preventing accidental scope bypass
- **Layered scoping**: `repo.withScope({ ownerSpace })` extends an existing scoped repo without mutating it
- **Transaction-safe**: `repo.withTransaction(manager)` preserves scope through transactions
- **Framework-agnostic core** with optional NestJS integration (`@nestjs/typeorm`)

```typescript
// Example: multi-field scope
const repo = new ScopedRepository(contextVectorRepo, {
  accountId: 'default',
  ownerSpace: agentSpace,
});
const records = await repo.find(); // WHERE account_id = 'default' AND owner_space = '...'
```

## Where it would apply in viking-ts

The codebase has pervasive manual scoping across four services:

| Service | Scoped fields | Manual WHERE clauses |
|---|---|---|
| `context-vector.service.ts` | `account_id`, `owner_space` | 6+ query methods |
| `memory.service.ts` | `account_id`, `owner_space` | 4+ query methods |
| `session.service.ts` | `account_id`, `user_id`, `agent_id` | 3+ query methods |
| `vfs.service.ts` | (none currently) | Candidate for future scoping |

Problems with the current manual approach:
1. **Scope is optional**: most query methods accept `accountId?: string`, making unscoped queries possible by omission
2. **Inconsistent application**: resource searches skip `account_id` filtering entirely, memory searches include it
3. **Hardcoded defaults scattered**: `accountId: 'default'` and `ownerSpace: ''` appear 15+ times across files
4. **No compile-time enforcement**: forgetting to pass scope silently returns cross-tenant data

## Why it does not fit today

Viking-ts uses **raw `better-sqlite3`** for all database access (`storage/database.service.ts`). There are no TypeORM entities, no `DataSource`, and no `Repository<T>` instances. The TypeORM dependency in `package.json` is configured for future migration tooling only.

`typeorm-scoped-repository` requires a TypeORM `Repository<T>` to wrap. It cannot operate on raw SQL or `better-sqlite3` prepared statements.

## Migration path

### Phase 1: TypeORM entity migration (prerequisite)

1. Define TypeORM entities for `context_vectors`, `sessions`, `session_messages`, `vfs_nodes`, `relations`
2. Create a `DataSource` configuration using `better-sqlite3` as the driver (TypeORM supports this)
3. Replace raw SQL in services with TypeORM repository calls
4. Generate TypeORM migrations from the existing schema
5. Verify all existing tests pass against the TypeORM layer

Estimated effort: 2-3 days of focused work. The schema is simple (5 tables, no complex joins), but every query in `ContextVectorService` and `MemoryService` needs rewriting.

### Phase 2: ScopedRepository integration

1. `npm install typeorm-scoped-repository@0.1.2`
2. Replace `Repository<ContextVector>` with `ScopedRepository` in services
3. Remove manual `accountId`/`ownerSpace` parameter threading from all query methods
4. Add scope construction at the request boundary (controller or middleware)
5. Remove optional scope parameters, making all queries scope-mandatory

### Phase 3: Fortress hardening

1. Scope `vfs_nodes` (currently unscoped, potential cross-tenant leak)
2. Add integration tests verifying scope isolation (query with wrong scope returns empty)
3. Consider request-scoped NestJS providers that auto-inject scope from auth context

## Recommendation

**Do not integrate now.** The prerequisite TypeORM migration is the real work, and it should be driven by its own need (query complexity, migration tooling, or Postgres readiness) rather than pulled forward for this package alone.

**Revisit when:**
- The Postgres migration (see `docs/postgres-setup.md`) begins, since that will require a proper ORM layer anyway
- A second tenant or account is actively used, making scope bugs a real risk rather than theoretical
- The raw SQL in `ContextVectorService` becomes hard to maintain (it is getting close)

When the time comes, the migration is straightforward: the package API is minimal, the scope model maps directly to existing `account_id`/`owner_space` columns, and the fortress pattern would eliminate the class of bugs where scope is accidentally omitted.
