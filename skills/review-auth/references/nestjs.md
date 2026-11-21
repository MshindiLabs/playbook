# NestJS checks for an auth review

Apply these when the project uses NestJS (`@nestjs/core` in `package.json`), on top of the steps in
`SKILL.md`. A documented project convention still wins. They hold for Passport, `@nestjs/jwt` and
the newer first-party authentication packages alike; check which one the project uses.

## Sign-in must not reveal which accounts exist

- **Do the password work even when there is no user.** `if (!user) throw` before the hash compare
  answers an unknown address in microseconds and a wrong password in tens of milliseconds, so the
  timing lists the registered addresses. With no user, compare against a fixed hash made at the same
  cost as stored hashes, then refuse. The same applies to an account with no password. High.
- **One answer for every failure before the password is proven.** "Account is inactive",
  "account locked" or "email not verified" given before the compare tells anyone the account
  exists. Check state after a correct password, or answer it identically. Medium.
- **Look-ups that throw their own 404.** A repository `findByEmail()` that throws
  `NotFoundException('Account with email … not found')` by default turns sign-in into a lookup
  service, and the handler's own 401 never runs. Mocked tests that return `null` hide it. High.
- **Stored hashes at one cost.** A seed or import that hashes at a higher cost makes those accounts
  slower to check, and so visible by timing. Low.

## Tokens and secrets

- **HS256 keys need at least 32 bytes.** Never hash, pad or derive a longer key from a short secret
  to satisfy a library: tokens are then signed with a different key from the one other services
  verify with. Medium.
- **Read roles and permissions from the database on each request**, not from token claims. Claims
  outlive a role change or a deleted user, and a user-chosen role name in a claim is not proof of
  anything. High when a decision rests on a claim.
- **Refresh tokens rotate**, and a reused one revokes its family. Access tokens stay short-lived.

## Guards

- **Guard metadata on the class.** `reflector.get(KEY, context.getHandler())` misses metadata set
  on the controller; `reflector.getAllAndOverride(KEY, [context.getHandler(), context.getClass()])`
  reads both. A guard that misses it skips the check for every route in that controller. High.
- **Global guard order follows registration order.** A guard that needs `request.user` (a
  permission guard, a per-user rate limit) must run after the authentication guard. Registered in
  the root module's own `providers`, it can run first and see no user. Medium.
- **Deny by default.** A route with neither a public marker nor a permission declaration should be
  refused, not open. Medium.
- **401 is no or bad credentials; 403 is signed in but not allowed.** Low.

## Long-lived connections and shared responses

- **Server-sent events and WebSockets authenticate once**, when the stream opens. The stream keeps
  its user after the token, session or API key is revoked, or the user is deleted. It should end
  on revocation (for example `takeUntil` on a revocation signal). High for admin or financial data.
- **`CacheInterceptor` keys responses by URL.** On a route that answers per user, the next user
  gets the first user's response. High.
- **CORS with credentials needs a list of origins.** `origin: true` reflects any origin, so every
  site can call the API as the signed-in user. High.
- **Mass assignment.** Without `ValidationPipe({ whitelist: true })`, a body spread into an entity
  can set `ownerId` or `role`. High.
- **Request-scoped providers** spread to everything that injects them, and their lifecycle hooks
  never run. Per-request identity is usually better read from the request or an
  `AsyncLocalStorage` context. Low.

Adapted from the NestJS agent skills (`nestjs`, `nestjs-auth`, `nestjs-feature`); see
[UPSTREAM.md](../../UPSTREAM.md).
