# NestJS checks for query safety

Apply these when the project uses NestJS (`@nestjs/core` in `package.json`) with TypeORM, Prisma,
Drizzle or a raw driver, on top of the steps in `SKILL.md`. A documented project convention still
wins.

## Writes that stay correct under concurrent requests

- **Read, then save the whole entity.** TypeORM's `save()` inserts the row if it has gone, so a
  PATCH that loaded a row just before a concurrent DELETE puts it back; an `upsert` does the same
  in any ORM. Update with a conditional statement (`repo.update({ id, ownerId }, changes)`, a
  Prisma `updateMany` with the owner in `where`, Drizzle `update().where(...).returning()`) and
  treat no affected row as 404. High.
- **Scope by owner in the query**, not after loading: `where: { id, ownerId }`. A row that is not
  the caller's is then simply not found. Hand a missing ownership check to the `review-auth`
  skill.
- **Map constraint violations instead of pre-checking.** "Is the email taken? Then insert" lets two
  requests both pass. Insert and catch the unique violation (PostgreSQL `23505`, Prisma `P2002`,
  SQLite `SQLITE_CONSTRAINT_UNIQUE`; Drizzle wraps the driver error, so walk `error.cause`) and
  answer 409. Medium.
- **Check-then-write needs a constraint or a transaction.** "Count the admins, then demote one"
  races without one. Medium.
- **Async drivers interleave between statements.** A synchronous SQLite driver in tests hides races
  that appear on PostgreSQL.

## Transactions and connections

- **Never await a network call inside a transaction** (an HTTP request, a queue publish, an email).
  It holds a pooled connection and its locks for the whole call, and a slow third party drains the
  pool. Call out before or after, or write to an outbox. High.
- **One database client.** With Prisma, one `PrismaService` provider exported from one module; a
  `new PrismaClient()` per service opens a pool each. Medium.

## Types that come back wrong

- **`bigint` and `numeric` arrive as strings** through `pg`. Arithmetic on them concatenates. Choose
  the column mode on purpose, and keep money as integer minor units or a decimal type handled as
  strings. Medium.
- **Timestamps in UTC** (`timestamptz` in PostgreSQL), converted at the edges. Low.
- **Data that must survive a restart** never lives in an in-memory database.

## Paging

- A cursor (`WHERE id > :after ORDER BY id LIMIT :n`) needs no `COUNT(*)` and stays stable under
  inserts. If the API's documented convention is a page-and-size envelope with a total, keep it and
  check the count query's cost instead; the envelope itself belongs to the `review-api` skill.

Adapted from the NestJS agent skills (`nestjs-data`); see [UPSTREAM.md](../../UPSTREAM.md).
