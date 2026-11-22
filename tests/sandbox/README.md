# Sandbox acceptance test cases

Automated entry point: `node scripts/smoke-test.mjs` (requires `npm run build` first). The script
starts a backend instance that uses a temporary SQLite database and working directory, then runs the
following checks through the public API:

| Case | Assertion |
|---|---|
| `while(1);` | Status `TLE`, no leftover `/workspace/prog` process on the host |
| Compile error | Status `CE`, returns the error diagnostics for `main.cpp` |
| `puts` infinite loop | Status `OLE`, stdout is truncated |
| 300 MiB allocation | Status `MLE`, cgroup peak of about 256 MiB |
| `system("cat /etc/passwd")` | Only the fake `sandbox:x:10000` is visible; no host accounts |
| `#include </etc/hostname>` | Compilation fails (the host path does not exist in the jail) |
| `socket + connect(1.1.1.1:80)` | The external connection attempt fails |
| `-fplugin=/tmp/x.so` | HTTP 400 / `FLAG_NOT_ALLOWED` |
| Multi-file project | Both files land in the workspace together and compile |
| fork bomb / timeout | cgroup `pids.max` and process-group cleanup take effect |

Additional manual checks:

- Use `strace -f` to observe seccomp rejecting calls such as `mount` and `ptrace` (in a normal run).
- `pgrep -af 'lldb-dap|nsjail|/workspace/prog'` should return nothing 2 seconds after the session ends.
- Confirm in the browser DevTools Network tab that no outbound network requests are made.

The smoke case only checks that `connect()` returns `-1`; it does not assert the exact errno or
which boundary caused the failure. Compile/run seccomp policies reject network socket syscalls,
and the debug policy relies on its network namespace to prevent external connections.
