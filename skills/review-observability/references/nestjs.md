# NestJS checks for an observability review

Apply these when the project uses NestJS (`@nestjs/core` in `package.json`), on top of the steps in
`SKILL.md`. A documented project convention still wins. Check the installed versions (the lockfile)
before citing a version-specific rule.

## Configuration

- **A config value read at the top of a feature module's file** runs on import, before
  `ConfigModule` has loaded anything, so it is `undefined` or a hard-coded default. Medium.
- **`process.env` read in another module's `forRoot()`.** On `@nestjs/config` 12 and later the
  values are assigned after an `await`, so the read is `undefined`; on earlier versions it works
  only when `ConfigModule.forRoot()` comes first in the same `imports` array. Flag it on version 12
  or later, or when the order is wrong; otherwise report it as a question. Either way,
  `forRootAsync({ inject: [ConfigService], useFactory })` removes the doubt and fails startup loudly
  on a missing value. Medium.

## Background work

- **`@Cron()` runs on every instance.** Two replicas send the reminder twice. A job that must run
  once needs a lock (a database row or a Redis lock). It also runs in the server's time zone, which
  is UTC in containers and local on laptops; pass `timeZone` for a job tied to a place. Medium.
- **`@OnEvent()` listeners log and swallow their errors by default** (`suppressErrors: true`), so
  the code that emitted the event never learns the listener failed. Turning that off alone makes
  it worse: `emit()` does not wait for async listeners, so the error becomes an unhandled
  rejection. Pass `{ suppressErrors: false }` and `await emitter.emitAsync(...)` at the emit site,
  or make the work a queued job with retries. Medium.
- **BullMQ jobs are not retried unless `attempts` is set.** Anything that calls out needs `attempts`
  and `backoff`. Retries mean a job can run twice, so it must be idempotent, and a job id derived
  from the work stops duplicates. A custom id may not contain `:` (BullMQ throws), so use
  `welcome-email-${userId}`, not a colon. Without `removeOnComplete` and `removeOnFail`, Redis
  memory grows with every job. Medium.
- **Work that must survive a restart** (an email due tomorrow) is stored and picked up again at
  startup, not held in a `setTimeout`, so a restart does not lose it silently. Medium.

## Health and shutdown

- **The health endpoint in Step 8 is the readiness check**: it checks the dependencies the service
  needs. A separate liveness check, if the deployment uses one, should not, or a database outage
  restarts every instance. `@nestjs/terminus` provides both. Low.
- **Graceful shutdown.** `app.enableShutdownHooks()`, so `SIGTERM` closes connections and finishes
  in-flight work instead of cutting requests off mid-way. Low.

## Logs and errors

- **Unexpected errors are logged once, in the global exception filter**, with a generic 500 to the
  caller. Logging in every layer prints one failure several times.

## Hand off

These come up in a NestJS review but are not observability; one line each under "Handed off":

- A per-user rate limit whose throttler guard runs before authentication: the `review-auth` skill.
- To the `review-changes` skill:
  - Node's idle keep-alive shorter than the load balancer's, which shows as occasional 502s. It is
    5 s on the Express and plain Node adapters; Fastify's default differs.
  - CPU-heavy work on the request path.
  - State kept in process memory (rate-limit counts, stream subscribers, sessions, caches) while
    more than one instance runs.

Adapted from the NestJS agent skills (`nestjs-production`); see [UPSTREAM.md](../../UPSTREAM.md).
