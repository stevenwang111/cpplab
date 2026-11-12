# CppLab · Online C++ IDE

A C++ edit / compile / run workbench that lives entirely in the browser tab. clang itself is
compiled to WebAssembly, the editor talks to it through a Worker, and the produced `.wasm` is
executed against a hand-written WASI shim. **There is no backend**: nothing is uploaded,
nothing is executed on a server, and the whole thing is a static site.

> **中文文档**: [README-zh_CN.md](README-zh_CN.md)

![CppLab home](docs/screenshots/home.png)

## Features

- **Editing**: Monaco Editor with C++ highlighting, bracket matching, auto-indent, code folding,
  minimap, and snippet completion. Auto-save to IndexedDB (700 ms debounce) plus local undo.
- **Multi-file**: file tabs, create / delete / switch the entry file, one object file per
  translation unit, linked into a single module.
- **Compile & run**: clang++ semantics on a `wasm32-unknown-emscripten` triple, C++17/20/23,
  `-O0…-O3`/`-Os`, a compiler-flag allowlist, stdin, streaming stdout/stderr.
- **Diagnostics**: parses `file:line:col: error:` from clang into the "Problems" panel and Monaco
  markers; clicking a problem jumps to the location.
- **Resource limits**: memory is baked into the module at link time, time is enforced by
  terminating the Worker, output is counted as it is written. Results are classified as
  `OK / CE / RE / TLE / MLE / OLE / IE`.
- **Run history**: the last 60 runs keep a source snapshot, stdin, output and status; any past
  run can be restored.
- **Bilingual UI**: one message catalog shared by the client and the toolchain layer, so phase
  messages, limit notes and errors speak the same language as the interface. First visit follows
  the browser; switch any time in Settings → Language.
- **No network, no filesystem**: the runner only receives file descriptors 0/1/2, argv, a clock
  and a random source. `sock_*` and `path_*` return `ENOSYS`.

## Quick start

Requirements: Node.js ≥ 22.5 for the dev server and build. Any modern browser with WebAssembly;
SharedArrayBuffer (and therefore `crossOriginIsolated`) is used when available.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Production build and local preview:

```bash
npm run build      # tsc --noEmit + vite build → dist/
npm start          # vite preview on http://127.0.0.1:4173
```

`dist/` is a plain static site — copy it to any static host. The first compile downloads the
pinned toolchain (~41 MB brotli, cached by the browser and by the toolchain VFS) from
`cdn.jsdelivr.net`; everything after that runs offline.

### Cross-origin isolation headers

The toolchain prefers `SharedArrayBuffer` for its stdin channel. Serve the site with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`vite dev` and `vite preview` already send them. On a host where you cannot set headers, the app
registers `coi-serviceworker` on first load and reloads once; if the browser still reports
`crossOriginIsolated === false`, compilation keeps working — only interactive stdin degrades.

## Architecture

```text
Main thread (React + Monaco + IndexedDB)
  ├─ api.ts            local façade: project / files / format / run / history
  ├─ wasm/toolchain.ts  boot + warmup + compile pipeline (serialised tool calls)
  │     └─ Worker: @gameguild/emception-browser  → clang, wasm-ld (LLVM 23.0.0git)
  └─ wasm/run/runner.ts one Worker per run: instantiate + WASI shim + limits
```

Compile pipeline, per translation unit:

```text
clang -cc1 -triple wasm32-unknown-emscripten -emit-obj … -o /tmp/main.o /home/user/main.cpp
wasm-ld /tmp/main.o -o /tmp/program.wasm --entry=main --initial-memory=… --max-memory=…
```

then the linked bytes are transferred to the runner Worker, instantiated with a WASI import
object, and `__wasm_call_ctors` + `main` are called.

### Directory layout

```text
src/client:
  App.tsx                 workbench state and interactions
  api.ts                  local façade over the toolchain, storage and run pipeline
  capabilities.ts         clang version, cross-origin isolation, limits
  wasm/constants.ts       pinned manifest URL, workspace paths, bundle list
  wasm/flags.ts           cc1 / wasm-ld argv assembly + compiler-flag allowlist
  wasm/diagnostics.ts     clang diagnostic parsing
  wasm/toolchain.ts       worker boot, workspace sync, compile + link
  wasm/toolchain.worker.ts  worker entry (imports the emception worker runtime)
  wasm/run/protocol.ts    runner message types
  wasm/run/runner.worker.ts WASI shim, trap classification
  wasm/run/runner.ts      per-run supervisor: Worker lifecycle, TLE, output budget
  wasm/isolation.ts       COOP/COEP check + coi-serviceworker fallback
  storage/db.ts           IndexedDB: project / files / runs
  components/             TopBar, editor, bottom panel, history drawer, dialogs
  editor/monaco.ts        theme, C++ snippets, language configuration
  styles/app.css          LeetCode-style visual system

src/shared:
  types.ts                wire types shared by UI, compile and run layers
  i18n/                   message catalog (zh-CN / en)
```

## Resource limits

| Dimension | Default | Enforcement |
|---|---|---|
| Wall clock | 2 s (200 ms – 10 s) | `worker.terminate()` from the main thread → `TLE` |
| Memory | 256 MiB (64 – 512 MiB) | `wasm-ld --max-memory`; growth past it fails → `MLE` |
| Output | 64 KiB | counted in `fd_write` → `OLE` |
| Files | 16, 256 KiB each | request validation before compiling |
| stdin | 1 MiB | truncated at the boundary |

Limits live in `localStorage` (`cpplab.runLimits`) and are clamped in `api.ts`.

## Security model

The threat model changed with the architecture: user code never reaches a server, so the
question is no longer "can it escape a jail" but "what can a `.wasm` module reach from inside a
Worker".

1. **The compiler is sandboxed by construction.** clang is a WebAssembly module running in a
   Worker with a virtual filesystem; it can only open files the IDE copied in.
2. **The runner is sandboxed by the import table.** The module gets exactly the imports the shim
   provides — three file descriptors, argv, `clock_time_get`, `random_get`, `proc_exit`. Every
   other `wasi_snapshot_preview1` entry (`path_open`, `sock_connect`, …) returns `ENOSYS`.
3. **No parser for a filesystem or a network exists in the runner.** There is nothing to escape
   *to*: no host objects are handed over, and the Worker has no privileges the page lacks.
4. **Output is capped at the write.** `fd_write` counts bytes and aborts the run with `OLE`
   before the buffer can grow.
5. **Memory is capped at link time.** `--max-memory` makes growth fail inside the module; the
   page's heap is never at the mercy of the program.
6. **Time is capped by killing the Worker.** A `while(true)` loop cannot be interrupted any other
   way; a fresh Worker per run also means no state survives into the next run.
7. **Compiler flags are an allowlist, not passthrough.** `-D…`, `-I…` (workspace-relative only),
   `-DDEBUG`, `-DNDEBUG`; `-lm` is silently ignored because libm is part of libc. Driver options
   such as `-fplugin`, `-wrapper`, `@file`, `-specs=`, `-B` have no meaning on the `-cc1` line
   and are rejected.
8. **Storage is local.** Project, files and runs live in IndexedDB on the device. The only network
   request the app makes is the toolchain bundle download from the pinned CDN URL.

Known and accepted limitations:

- A page cannot revoke its own capabilities, so a wasm module shares the origin's storage quota.
  Nothing in the design lets user code reach other origins, but a runaway module can still fill
  the disk quota before the memory ceiling stops it.
- `-pthread` is unavailable (needs SharedArrayBuffer in the module, which needs a different
  libc build); `-fsanitize=…` needs extra runtime bundles that are not in the pinned toolchain.
- C++ exceptions do not unwind: the target needs the emscripten JS unwinder, which a plain
  `wasm-ld` link does not include. A thrown exception aborts with an explicit message.

## Known issues

- **Formatting is disabled.** `clang-format` is not part of the pinned toolchain bundle, so the
  capability probe returns false and the button explains that instead of failing silently. Adding
  it means adding a bundle to the toolchain manifest.
- `tzset` has no data, so `localtime` runs in UTC.
- The default time limit is 2 s, which is a judge-style default. Raise it in Settings for
  heavier programs.
- Interactive stdin degrades to end-of-input when `SharedArrayBuffer` is unavailable.

## Testing

```bash
npm run typecheck    # tsc --noEmit
npm run build
npm run i18n:check   # zh-CN and en share every key and placeholder; no stray CJK in src/scripts
npm run i18n:ui      # headless Chromium against a running preview: English page has no Chinese,
                     # the switch flips the UI and survives a reload
```

`npm run i18n:ui` expects a server at `http://127.0.0.1:4173`; override with `BASE_URL=…`.

Manual acceptance checks (each one was exercised end-to-end in Chromium before the 2.0 release):

```text
✓ a std::vector sort program prints "sorted: 3 10 17 24 31 38 45 52"
✓ multi-file project (main.cpp + lib.cpp) links and prints total=10
✓ type error → CE, "Problems" lists main.cpp:4:9, clicking jumps to the line
✓ std::cin reads stdin from the "Input" panel
✓ while(true) → TLE after the configured limit
✓ unbounded output → OLE, truncated at 64 KiB
✓ 8 MiB chunks until the heap ceiling → MLE
✓ return 7 → RE with an explicit exit-code note
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + Enter` | Compile and run |
| `Ctrl/⌘ + S` | Save now |
| `Ctrl/⌘ + Shift + F` | Format (reports that the formatter is unavailable in this toolchain) |

## References

- [docs/wasm-client-only-feasibility.md](docs/wasm-client-only-feasibility.md) — why this
  architecture, what it costs, and which parts of the old server design survive
- [AGENTS.md](AGENTS.md) — boundaries and constraints for anyone (human or agent) changing this
  codebase

## License

[MIT](LICENSE)
