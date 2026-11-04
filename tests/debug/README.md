# DAP debugging acceptance

`node scripts/smoke-test.mjs` includes a real DAP session:

1. `POST /api/debug/start` compiles and starts `lldb-dap` inside the debug sandbox.
2. `initialize` → `setBreakpoints` → `launch` → `configurationDone`.
3. Assert that `stopped(reason=breakpoint)` is received.
4. The first `stackTrace` frame is `main`, with path `/workspace/main.cpp`.
5. `scopes` contains `Locals`, and `variables` contains the local variable `p`.
6. After `continue`, `terminated` is received and the program's stdout is `result=9`.

Manual acceptance on the browser side:

- Line breakpoints show a filled red dot; breakpoints on empty lines show a hollow circle and are marked "unverified" in the breakpoint list.
- The current execution line is highlighted, and the view auto-scrolls to that line after a hit.
- Clicking a call-stack entry jumps and switches frames; the variable tree lazy-loads nested `struct` / `vector`.
- Watch refreshes after every `stopped`; the REPL can only evaluate while paused.
- 5 minutes idle / 30 minutes hard timeout closes the session, and the working directory and process group are reclaimed.

Debugging notes: the MVP does not provide an interactive stdin to the debugged program. Programs that read `std::cin` will wait for input while debugging; verify through the "Input" panel first, or switch to fixed input before debugging.
