# Development history

This file keeps superseded plans, decisions, and point-in-time verification notes.
For current behavior, see [`README.md`](../README.md), the current
[`multi-user-auth.md`](multi-user-auth.md), and the acceptance guides under
[`tests/`](../tests/).

## 2026-11-22 — Multi-user authentication (M5)

### Starting point and decisions

The original design proposal addressed a single shared `playground` project,
unauthenticated HTTP and WebSocket paths, and browser preferences shared across
accounts. The implementation was scoped for a single-process installation with
local accounts and no external identity provider.

The confirmed decisions were:

- Administrators create accounts; there is no public registration.
- Each account gets a personal project. The current UI has no project switcher.
- A login replaces that account's previous session; one account has at most one
  active session.
- Use a reverse proxy for HTTPS deployments. Keep the development and default
  listener on loopback.
- Administrators can manage accounts, but cannot read another user's source or
  run output.

### Implementation sequence

The work was tracked as M5.0–M5.7:

1. Update security requirements and deployment documentation.
2. Add users, sessions, project ownership, migration, and the account CLI.
3. Add login, logout, password changes, cookies, Origin checks, and login limits.
4. Scope HTTP resources, run history, and debug sessions to their owner.
5. Authenticate WebSocket upgrades and revoke open connections when a session
   becomes invalid.
6. Add per-account quotas, audit events, login screens, account-scoped browser
   storage, and bilingual messages.
7. Run unit, end-to-end, localization, and sandbox/debugger acceptance checks.

### Final implementation and intentional differences

- User records and auth sessions live in SQLite. Session tokens are random
  32-byte values; only SHA-256 hashes are stored. A unique partial index and a
  transaction enforce the one-active-session rule.
- The first account adopts all projects without an owner, including the legacy
  `playground` project. If ownerless projects remain after accounts exist,
  business API requests fail closed with `503 ORPHAN_PROJECTS`; health and
  authentication endpoints remain available for recovery.
- The admin HTTP API was implemented, but an admin-management UI was not.
- A successful login clears that username's failure/backoff window; the IP
  request window continues to count attempts.
- Open WebSockets are checked for revocation by a one-second sweep. Run/debug
  session state remains in memory and does not survive a server restart.
- The client namespaces editor preferences by user. The language preference
  remains global.

### Verification snapshot

The original implementation record reported, on 2026-11-22:

- 28 unit tests.
- 27 end-to-end smoke checks, using real login and exercising the sandbox and
  DAP debugger.
- 443 localization keys with matching English and Chinese catalogs.
- A browser localization check requiring a real account.
- During the documentation audit, `node scripts/security-test.mjs` passed 8
  security regression checks.

These are historical counts, not guaranteed current totals. Run the commands in
the current README to verify the checked-out revision.

## 2026-11-22 — Documentation and annotation corrections

An audit found several descriptions left over from earlier sandbox
configurations. The current implementation does not pass `--rw` to nsjail,
disables the user namespace, and runs jailed processes as a dedicated host UID
(default `10000`) distinct from the service UID. Rootfs permissions supplement
the read-only jail; `/workspace` and explicit tmpfs mounts remain writable.

The compile/run/format seccomp policies reject network socket syscalls. The
debug policy permits the socket operations it needs, and its network namespace
has no external route. The smoke test checks that a connection attempt fails;
it does not establish that the network namespace alone caused the failure.

The old documentation also had a stale security-audit link, outdated section
references, and inconsistent `F-xx` labels. Those were replaced with current
descriptions; the audit labels were not part of the runtime interface.
