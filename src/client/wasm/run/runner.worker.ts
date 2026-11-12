/**
 * WebAssembly runner.
 *
 * The compiled artifact is a WASI command module, so the only host surface it
 * gets is the import object built below: three file descriptors, argv, a clock
 * and a random source. No filesystem, no sockets, no host objects.
 *
 * Resource limits are enforced here and in `runner.ts`:
 *   - memory  — baked into the module at link time (`--max-memory`); growth
 *               past the ceiling fails and is reported as MLE.
 *   - time    — the main thread terminates this Worker (TLE).
 *   - output  — counted in `fd_write` (OLE).
 */
import type { RunnerEvent, RunnerFailureKind, RunnerRequest } from './protocol';

interface WorkerScope {
  postMessage(message: RunnerEvent): void;
  onmessage: ((event: MessageEvent<RunnerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

class ExitSignal {
  constructor(readonly code: number) {}
}

class OutputLimitSignal {}

/** Raised by the `env` shims when the program aborts on its own. */
class AbortTrap {
  constructor(readonly reason: string) {}
}

const WASI_SUCCESS = 0;
const WASI_EBADF = 8;
const WASI_ENOSYS = 63;
const WASI_ENOENT = 44;

let memory: WebAssembly.Memory | undefined;
/** Set the first time a heap growth request is refused by the ceiling. */
let heapExhausted = false;
let decoder = new TextDecoder();
let stdoutBytes = 0;
let stderrBytes = 0;
let outputLimit = 64 * 1024;
let emittedBytes = 0;

function emit(event: RunnerEvent): void {
  scope.postMessage(event);
}

function view(): DataView {
  if (!memory) throw new Error('wasm memory is not available');
  return new DataView(memory.buffer);
}

function bytes(): Uint8Array {
  if (!memory) throw new Error('wasm memory is not available');
  return new Uint8Array(memory.buffer);
}

function account(kind: 'stdout' | 'stderr', text: string): void {
  const size = text.length;
  if (kind === 'stdout') stdoutBytes += size;
  else stderrBytes += size;
  emittedBytes += size;
  if (emittedBytes > outputLimit) {
    // Tell the main thread before unwinding so the OLE result keeps the tail.
    emit({ type: 'failure', kind: 'OLE', message: '', memoryKb: memoryKb() });
    throw new OutputLimitSignal();
  }
  emit({ type: kind, data: text });
}

function memoryKb(): number {
  return memory ? Math.round(memory.buffer.byteLength / 1024) : 0;
}

function buildImports(stdin: Uint8Array, args: string[]) {
  let stdinOffset = 0;
  const encodedArgs = args.map((arg) => new TextEncoder().encode(`${arg}\0`));
  const argsBytes = encodedArgs.reduce((total, arg) => total + arg.length, 0);

  function fdWrite(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
    const data = view();
    const buffer = bytes();
    let written = 0;
    for (let index = 0; index < iovsLen; index += 1) {
      const base = iovsPtr + index * 8;
      const ptr = data.getUint32(base, true);
      const len = data.getUint32(base + 4, true);
      if (len === 0) continue;
      const text = decoder.decode(buffer.subarray(ptr, ptr + len));
      written += len;
      if (fd === 1) account('stdout', text);
      else if (fd === 2) account('stderr', text);
    }
    data.setUint32(nwrittenPtr, written, true);
    return WASI_SUCCESS;
  }

  function fdRead(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number {
    const data = view();
    const buffer = bytes();
    if (fd !== 0) {
      data.setUint32(nreadPtr, 0, true);
      return WASI_EBADF;
    }
    for (let index = 0; index < iovsLen; index += 1) {
      const base = iovsPtr + index * 8;
      const ptr = data.getUint32(base, true);
      const len = data.getUint32(base + 4, true);
      if (len === 0) continue;
      if (stdinOffset >= stdin.length) {
        data.setUint32(nreadPtr, 0, true);
        return WASI_SUCCESS;
      }
      const count = Math.min(len, stdin.length - stdinOffset);
      buffer.set(stdin.subarray(stdinOffset, stdinOffset + count), ptr);
      stdinOffset += count;
      data.setUint32(nreadPtr, count, true);
      return WASI_SUCCESS;
    }
    data.setUint32(nreadPtr, 0, true);
    return WASI_SUCCESS;
  }

  return {
    fd_write: fdWrite,
    fd_read: fdRead,
    fd_close: () => WASI_SUCCESS,
    fd_seek: () => WASI_EBADF,
    fd_fdstat_get: (fd: number, statPtr: number) => {
      const data = view();
      const buffer = bytes();
      data.setUint8(statPtr, fd <= 2 ? 2 : 4);
      buffer.fill(0, statPtr + 1, statPtr + 24);
      if (fd === 0) data.setBigUint64(statPtr + 8, BigInt(0x2), true);
      else if (fd === 1 || fd === 2) data.setBigUint64(statPtr + 8, BigInt(0x40), true);
      return WASI_SUCCESS;
    },
    fd_prestat_get: () => WASI_EBADF,
    fd_prestat_dir_name: () => WASI_EBADF,
    proc_exit: (code: number) => {
      throw new ExitSignal(code);
    },
    environ_sizes_get: (countPtr: number, sizePtr: number) => {
      const data = view();
      data.setUint32(countPtr, 0, true);
      data.setUint32(sizePtr, 0, true);
      return WASI_SUCCESS;
    },
    environ_get: () => WASI_SUCCESS,
    args_sizes_get: (countPtr: number, sizePtr: number) => {
      const data = view();
      data.setUint32(countPtr, encodedArgs.length, true);
      data.setUint32(sizePtr, argsBytes, true);
      return WASI_SUCCESS;
    },
    args_get: (argvPtr: number, argvBufPtr: number) => {
      const data = view();
      const buffer = bytes();
      let offset = argvBufPtr;
      encodedArgs.forEach((arg, index) => {
        data.setUint32(argvPtr + index * 4, offset, true);
        buffer.set(arg, offset);
        offset += arg.length;
      });
      return WASI_SUCCESS;
    },
    clock_time_get: (_clockId: number, _precision: number, timePtr: number) => {
      const data = view();
      data.setBigUint64(timePtr, BigInt(Math.round(performance.now() * 1_000_000)), true);
      return WASI_SUCCESS;
    },
    random_get: (bufPtr: number, bufLen: number) => {
      crypto.getRandomValues(bytes().subarray(bufPtr, bufPtr + bufLen));
      return WASI_SUCCESS;
    },
    // The sandbox exposes stdio only: every filesystem / socket call is denied.
    path_open: () => WASI_ENOENT,
    path_filestat_get: () => WASI_ENOENT,
    path_create_directory: () => WASI_ENOSYS,
    path_remove_directory: () => WASI_ENOSYS,
    path_unlink_file: () => WASI_ENOSYS,
    path_rename: () => WASI_ENOSYS,
    path_readlink: () => WASI_ENOSYS,
    path_symlink: () => WASI_ENOSYS,
    fd_advise: () => WASI_SUCCESS,
    fd_allocate: () => WASI_ENOSYS,
    fd_datasync: () => WASI_SUCCESS,
    fd_sync: () => WASI_SUCCESS,
    fd_tell: () => WASI_ENOSYS,
    fd_readdir: () => WASI_ENOSYS,
    fd_renumber: () => WASI_ENOSYS,
    fd_pwrite: () => WASI_ENOSYS,
    fd_pread: () => WASI_ENOSYS,
    poll_oneoff: () => WASI_ENOSYS,
    sched_yield: () => WASI_SUCCESS,
    sock_accept: () => WASI_ENOSYS,
    sock_recv: () => WASI_ENOSYS,
    sock_send: () => WASI_ENOSYS,
    sock_shutdown: () => WASI_ENOSYS,
  };
}

const PAGE_SIZE = 64 * 1024;

/**
 * The `env` namespace the emscripten-style libc expects.
 *
 * `emscripten_resize_heap` is the important one: dlmalloc grows the heap by
 * calling it, so leaving it unimplemented caps every program at the initial
 * memory size and turns normal allocations into aborts. The rest are the
 * pieces of libc that only exist as JS glue — they cannot work without the
 * emscripten runtime, so they report a clean failure instead of pretending.
 */
function buildEnvImports(memoryLimitBytes: number) {
  return {
    emscripten_resize_heap: (requestedSize: number): number => {
      if (!memory) return 0;
      const current = memory.buffer.byteLength;
      const want = Math.max(0, Math.trunc(requestedSize));
      if (want <= current) return 1;
      if (memoryLimitBytes > 0 && want > memoryLimitBytes) {
        heapExhausted = true;
        return 0;
      }
      const pages = Math.ceil((want - current) / PAGE_SIZE);
      try {
        if (memory.grow(pages) === -1) {
          heapExhausted = true;
          return 0;
        }
        return 1;
      } catch {
        heapExhausted = true;
        return 0;
      }
    },
    _abort_js: (): never => {
      throw new AbortTrap('abort');
    },
    __cxa_throw: (): never => {
      // Throwing needs the emscripten JS unwinder, which is not part of a plain
      // wasm-ld link. Stop here with a readable reason instead of returning
      // into the middle of the throw sequence.
      throw new AbortTrap('C++ exception thrown (no unwinder in this target)');
    },
    _tzset_js: (): void => {
      // No timezone data: leave the C strings empty so tzset falls back to UTC.
    },
  };
}

/**
 * Fill any import the module declares but we did not implement.
 *
 * The `memory` case matters when a module imports its linear memory: the
 * ceiling must be the one we linked with, not an arbitrary default.
 */
function stubFor(kind: string, maxLimitBytes: number): unknown {
  switch (kind) {
    case 'function':
      return () => 0;
    case 'memory': {
      const maximum = Math.max(1, Math.floor(maxLimitBytes / PAGE_SIZE));
      return new WebAssembly.Memory({ initial: Math.min(256, maximum), maximum });
    }
    case 'global':
      return new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
    case 'table':
      return new WebAssembly.Table({ element: 'anyfunc', initial: 1 });
    default:
      return undefined;
  }
}

function classifyTrap(
  error: unknown,
  memoryLimitBytes: number,
): { kind: RunnerFailureKind; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();
  if (text.includes('out of memory') || text.includes('failed to grow') || text.includes('memory allocation')) {
    return { kind: 'MLE', message };
  }
  // Once the heap has refused to grow the process is on borrowed time: whatever
  // it aborts with next is a consequence of the failed allocation.
  if (heapExhausted) return { kind: 'MLE', message: '' };
  // A failed allocation aborts the module with a bare `unreachable` trap and no
  // message of its own. That is only distinguishable from a genuine abort by
  // where the heap ended up: pinned at the ceiling we baked in at link time.
  const heap = memory?.buffer.byteLength ?? 0;
  if (memoryLimitBytes > 0 && heap >= memoryLimitBytes && text.includes('unreachable')) {
    return { kind: 'MLE', message: '' };
  }
  return { kind: 'RE', message };
}

async function runModule(request: RunnerRequest): Promise<void> {
  outputLimit = request.outputLimitBytes;
  const stdin = new TextEncoder().encode(request.stdin);

  let instance: WebAssembly.Instance;
  try {
    const module = await WebAssembly.compile(request.wasm);
    const imports: WebAssembly.Imports = {};
    const wasi = buildImports(stdin, request.args) as Record<string, unknown>;
    const env = buildEnvImports(request.memoryLimitBytes) as unknown as Record<string, unknown>;

    for (const descriptor of WebAssembly.Module.imports(module)) {
      const namespace = (imports[descriptor.module] ??= {}) as Record<string, WebAssembly.ImportValue>;
      const host = descriptor.module === 'env' ? env : wasi;
      const known =
        descriptor.module === 'wasi_snapshot_preview1' || descriptor.module === 'wasi_unstable' || descriptor.module === 'env'
          ? host[descriptor.name]
          : undefined;
      namespace[descriptor.name] = (known ?? stubFor(descriptor.kind, request.memoryLimitBytes)) as WebAssembly.ImportValue;
    }

    instance = await WebAssembly.instantiate(module, imports);
    // A module either exports its memory or imports the one we handed it over.
    memory = (instance.exports.memory as WebAssembly.Memory | undefined) ?? memory;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'failure', kind: 'IE', message, memoryKb: 0 });
    return;
  }

  const exported = instance.exports as Record<string, unknown>;
  const wasiStart = exported._start;
  const entry = exported.main;
  const ctors = exported.__wasm_call_ctors;

  try {
    // `_start` never returns a value (WASI commands report through proc_exit);
    // a bare `main` does, and that value is the process exit status.
    let code = 0;
    if (typeof wasiStart === 'function') {
      (wasiStart as () => void)();
    } else if (typeof entry === 'function') {
      if (typeof ctors === 'function') (ctors as () => void)();
      code = Number((entry as () => number)()) | 0;
    } else {
      throw new Error('the module exports neither _start nor main');
    }
    emit({ type: 'exit', code, memoryKb: memoryKb() });
  } catch (error) {
    if (error instanceof ExitSignal) {
      emit({ type: 'exit', code: error.code, memoryKb: memoryKb() });
      return;
    }
    if (error instanceof OutputLimitSignal) {
      emit({ type: 'failure', kind: 'OLE', message: '', memoryKb: memoryKb() });
      return;
    }
    if (error instanceof AbortTrap) {
      const kind: RunnerFailureKind = heapExhausted ? 'MLE' : 'RE';
      emit({ type: 'failure', kind, message: kind === 'MLE' ? '' : error.reason, memoryKb: memoryKb() });
      return;
    }
    const classified = classifyTrap(error, request.memoryLimitBytes);
    emit({ type: 'failure', kind: classified.kind, message: classified.message, memoryKb: memoryKb() });
  }
}

scope.onmessage = (event: MessageEvent<RunnerRequest>) => {
  if (event.data?.type !== 'start') return;
  decoder = new TextDecoder();
  stdoutBytes = 0;
  stderrBytes = 0;
  emittedBytes = 0;
  heapExhausted = false;
  void runModule(event.data);
};
