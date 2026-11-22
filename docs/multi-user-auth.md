# Multi-user authentication and account isolation

This document describes the current implementation. Deployment and command
examples are in [`README.md`](../README.md); superseded plans and rollout notes
are kept in [`HISTORY.md`](HISTORY.md).

## Account model

- Accounts are local. An administrator creates them with the CLI or the
  admin-only HTTP API; there is no public registration.
- Each account gets a personal project. The current UI uses one project per
  account, although the database schema permits more.
- Projects, files, run history, and live debug/run sessions are scoped to their
  owner. Administrators can manage accounts but cannot read other users' source
  or run output.
- The first account adopts every project whose `owner_id` is `NULL`, including
  a legacy `playground` project. If ownerless projects remain after accounts
  exist, business API requests fail closed with `503 ORPHAN_PROJECTS`.

## Authentication and sessions

- Passwords use Node's built-in scrypt (`N=32768`, `r=8`, `p=1`) with a
  per-password salt and a self-describing hash. Hash parameters can be upgraded
  on successful login. Unknown usernames also incur a dummy scrypt operation.
- Passwords are 10–128 characters; whitespace is significant and is not
  trimmed.
- A successful login issues a new 32-byte random token. SQLite stores only its
  SHA-256 hash. The cookie is `HttpOnly; SameSite=Strict; Path=/`; it is marked
  `Secure` for HTTPS according to `COOKIE_SECURE`.
- An account has at most one active session. Login and password change replace
  the previous session transactionally; a unique partial index enforces the
  invariant. Disabling an account and resetting its password revoke its
  session.
- Idle and absolute session lifetimes default to 8 hours and 7 days. They can
  be configured with `SESSION_IDLE_HOURS` and `SESSION_ABSOLUTE_DAYS`. Session
  activity is persisted at most once per minute; expired and old revoked rows
  are cleaned at startup and hourly.
- A forced password change blocks workspace API access until the password is
  changed. The user can still query their account, log out, or change password.

## HTTP, Origin, and WebSocket checks

- `/api/health` and `/api/auth/login` are public. Other API routes require a
  valid session cookie.
- State-changing API requests require a same-origin `Origin` header, including
  login. The login body limit is 8 KiB; other JSON API bodies are limited to
  3 MiB. Authentication is resolved before the general JSON body parser.
- Browser WebSocket upgrades validate `Origin`, authenticate the cookie, and
  check that the run/debug session belongs to that account before attaching.
  Non-browser clients may omit `Origin`, but still need a valid session.
- A one-second sweep closes open WebSockets with `4401` after their session is
  revoked, expired, or disabled. Other relevant close codes are `4403` for a
  different owner and `4404` for a missing session.
- Cross-account HTTP resources return `404` to avoid confirming that an ID
  exists. Business APIs return `503 ORPHAN_PROJECTS` while unresolved ownerless
  projects remain.

For reverse-proxy setup, preserve `Cookie` and `Origin`, configure
`TRUST_PROXY` as a hop count, and set `PUBLIC_ORIGIN` to the browser-visible
origin. See the README for deployment examples and transport warnings.

## Quotas and audit

- Process-wide concurrency limits are 2 compiles, 4 runs, and 2 debug sessions.
  Per-account limits are 1 active run and 1 active debug session.
- Run, format, and debug-start requests are rate-limited by client IP and by
  account. Login has separate IP and username limits plus increasing temporary
  backoff. Successful login clears that username's failure window, not the IP
  request window.
- Audit events cover authentication, session revocation, account changes, and
  run/debug lifecycle. Entries are bounded to 8 KiB per line and rotated at
  10 MiB × 5. Passwords, raw tokens, cookies, and request bodies are not logged.
- `data/` is restricted to `0700`; the SQLite database, WAL, and SHM files are
  restricted to `0600`.

## Current scope and limitations

- The admin HTTP API exists, but there is no admin-management UI.
- There is no public registration, self-service email reset, OIDC/LDAP,
  multi-project UI, shared project, or multi-instance session store.
- Run and debug sessions are process-local and are lost on server restart.
- Debug sessions do not provide interactive stdin to the debugged program.

## Verification

Use `npm run test:unit`, `npm test` (after `npm run build`), and
`npm run i18n:check`. The end-to-end smoke test uses real session cookies and
covers account isolation, Origin enforcement, session revocation, sandboxed
compile/run, formatting, and DAP debugging. Manual acceptance guides are in
[`tests/sandbox/README.md`](../tests/sandbox/README.md) and
[`tests/debug/README.md`](../tests/debug/README.md).
