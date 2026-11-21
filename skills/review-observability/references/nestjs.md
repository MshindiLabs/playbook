# NestJS checks for an observability review

Apply these when the project uses NestJS (`@nestjs/core` in `package.json`), on top of the steps in
`SKILL.md`. A documented project convention still wins.

## Configuration

- **`process.env` read in another module's `forRoot()`** can be `undefined`: `ConfigModule`
  validation loads `.env` after an `await`, and a value read at the top of a feature module's file
  runs on import, before any of it. Use `forRootAsync({ inject: [ConfigService], useFactory })`. A
  missing value then fails startup loudly instead of running with a default. Medium.

## Background work

- **`@Cron()` runs on every instance.** Two replicas send the reminder twice. A job that must run
  once needs a lock (a database row or a Redis lock). It also runs in the server's time zone, which
  is UTC in containers and local on laptops; pass `timeZone` for a job tied to a place. Medium.
- **`@OnEvent()` listeners swallow their errors by default** (`suppressErrors: true`), so the code
  that emitted the event never learns the listener failed. Pass `{ suppressErrors: false }`, or make
  the work a queued job with retries. Medium.
- **BullMQ jobs do not retry by default** (`attempts: 1`). Anything that calls out needs `attempts`
  and `backoff`, and retries mean a job can run twice, so it must be idempotent; a `jobId` derived
  from the work (`welcome-email:${userId}`) stops duplicates. Without `removeOnComplete` and
  `removeOnFail`, Redis memory grows with every job. Medium.
- **Work that must survive a restart** (an email due tomorrow) is stored and picked up again at
  startup, not held in a `setTimeout`. Medium.
- **CPU-heavy work** (image processing, large exports, crypto in a loop) blocks every request on the
  instance. Move it to a queue worker or a worker thread. Medium.

## Running behind a load balancer

- **Idle keep-alive.** Node closes an idle connection after 5 seconds; a load balancer that reuses
  it later gets a reset and answers 502 now and then. Set `keepAliveTimeout` above the balancer's
  idle timeout (for example 65 s against an ALB's 60 s), and `headersTimeout` slightly above that.
  Low, but it shows as unexplained 502s.
- **Graceful shutdown.** `app.enableShutdownHooks()` so `SIGTERM` closes connections and finishes
  in-flight work. Low.
- **More than one instance.** Rate-limit counts, server-sent-event subscribers, in-memory sessions
  and caches are per instance. Shared state goes in the database or Redis. Medium.
- **Health and readiness** (`@nestjs/terminus`): readiness checks the dependencies the service
  needs; liveness does not, or a database outage restarts every pod. Low.

## Rate limiting

- **A per-user limit needs the throttler guard after authentication.** Registered first, it sees no
  user and every caller behind one address shares a counter. Its tracker should key by user when
  there is one, by IP otherwise. Medium.

## Logs and errors

- **Unexpected errors are logged once, in the global exception filter**, with a generic 500 to the
  caller. Logging in every layer prints one failure several times.

Adapted from the NestJS agent skills (`nestjs-production`); see [UPSTREAM.md](../../UPSTREAM.md).
