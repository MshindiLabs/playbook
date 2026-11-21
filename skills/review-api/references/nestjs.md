# NestJS checks for an API review

Apply these when the project uses NestJS (`@nestjs/core` in `package.json`), on top of the steps in
`SKILL.md`. A documented project convention still wins. Check the installed major version
(`npm ls @nestjs/core` or the lockfile) before citing a version-specific rule.

## Validation at the boundary

- **class-validator `@IsOptional()` lets `null` through.** It skips every other rule for `null` as
  well as `undefined`, so `{"title": null}` reaches the service and usually fails as a 500 at the
  database. For "may be left out, never null", the field needs
  `@ValidateIf((_, value) => value !== undefined)` instead. `PartialType()` from
  `@nestjs/mapped-types` (or `@nestjs/swagger`) adds `@IsOptional()` to every field, with the same
  effect, unless it is given `{ skipNullProperties: false }`. Medium.
- **Nested objects and arrays are not validated** without `@ValidateNested()` and
  `@Type(() => Child)` from class-transformer. Without `@Type()`, any object passes unvalidated
  (Nest's `ValidationPipe` sets `forbidUnknownValues: false`). Medium.
- **The global `ValidationPipe` should strip unknown fields** (`whitelist: true`, plus
  `forbidNonWhitelisted: true` to answer 400 instead; the second does nothing without the first).
  Missing, it is a shape finding here, Medium; a body spread into a write that can then set
  `ownerId` or `role` is hand-off material for the `review-auth` skill.
- **Schema validation (Zod, Valibot, ArkType).** `.optional()` and `.partial()` already reject
  `null`. A boolean from a query string needs a string-to-boolean parser: `z.coerce.boolean()`
  turns `"false"` into `true`. Medium.
- **Path and query parameters are strings.** `@Query('page') page: number` holds `"1"` unless a pipe
  or `transform: true` converts it, so `page + 1` is `"11"`. `ParseIntPipe` answers 400 for a
  non-numeric id; if the contract says 404, it needs `errorHttpStatusCode`. Medium.
- **Guards run before pipes.** An anonymous request with a bad body gets 401, not 400. A test or
  contract that expects 400 there is wrong, not the code.

## Status codes and errors

- **`@Post()` answers 201.** A POST that creates nothing (sign-in, an action, a search) needs
  `@HttpCode(200)` or the code the contract names; a DELETE with no body, `@HttpCode(204)`. Low,
  medium if a client depends on the code.
- **Errors are Nest exceptions** (`NotFoundException`, `ConflictException`, ...). Anything else
  thrown becomes a 500, unless an exception filter maps it. A project that throws its own domain
  errors and maps them in one filter is following its convention. Medium.
- **A catch-all `@Catch()` filter also catches `HttpException`.** One that always answers 500
  turns every 400, 401 and 404 into a 500. It must handle `HttpException` first, or extend
  `BaseExceptionFilter` and call `super.catch()`. High.
- **One error shape.** If the contract fixes a body other than `{ statusCode, message, error }`,
  one global exception filter should produce it, including for validation errors and guard 401s.

## Routes and responses

- **Route order on the Express adapter.** `@Get(':id')` declared before `@Get('search')` answers
  `/search` with `id = 'search'`. Static paths go first. Medium.
- **Nest 11 and later (Express 5).** Wildcards are named (`files/{*path}`); an old `files/*` logs a
  legacy-route warning. Query strings parse flat, so `?filter[status]=done` is one key unless the
  app sets `'query parser'` to `'extended'`. Low.
- **Serialization only strips class instances.** `ClassSerializerInterceptor` and `@Exclude()` do
  nothing to a plain object, which is what Prisma, Drizzle and raw drivers return (TypeORM and
  MikroORM return entity instances, where `@Exclude()` works). Map to a response type, or use
  `@SerializeOptions({ type })` on Nest 10 and later. Returning the row is a Low shape finding as
  Step 7 says; a secret field going out with it is hand-off material for the `review-auth` skill.
- **A response-wrapping interceptor** (`map((data) => ({ data }))`) also wraps every server-sent
  event and streamed chunk. Those routes need skipping. Medium.
- **Global pipes, filters and guards made with `new`** (`app.useGlobalPipes(new X())`) get no
  dependency injection and are absent from the testing module. Register them as `APP_PIPE`,
  `APP_FILTER` or `APP_GUARD` providers when they need services or must run in tests. Low.

## Hand off

- To the `review-auth` skill:
  - `CacheInterceptor` on a route that answers per user (it keys by URL);
  - CORS with `origin: true`;
  - mass assignment through a missing `whitelist`;
  - a secret field (a password hash, a token) in a response body.
- Query cost, concurrent writes and paging queries: the `check-query-safety` skill.

Adapted from the NestJS agent skills (`nestjs-feature`); see [UPSTREAM.md](../../UPSTREAM.md).
