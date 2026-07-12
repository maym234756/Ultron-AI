# Lumivex AI Database Migrations

Lumivex AI supports both local SQLite and deployed Postgres through separate Prisma schemas. Keep provider-specific SQL migrations in this folder so production database changes are versioned, reviewable, and rollbackable instead of relying only on `prisma db push`.

- `sqlite/` applies to `prisma/schema.prisma`.
- `postgres/` applies to `prisma/schema.postgres.prisma`.

Use `db push` only for disposable local development. For shared or deployed databases, review and apply the matching SQL migration for the configured provider.