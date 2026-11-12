/**
 * Main-thread supervisor for a single program execution.
 *
 * A fresh Worker is created per run so that `terminate()` is a complete,
 * leak-free reset: that is the TLE mechanism, and it is also why a runaway
 * program cannot leave anything behind (no orphan processes, no shared state
 * with the next run).
 */
import type { RunStatus } from '../../../shared/types';
import RunnerWorker from './runner.worker?worker';
import type { RunnerEvent, RunnerRequest } from './protocol';

export interface ExecuteOptions {
  wasm: Uint8Array;
  stdin: string;
  timeMs: number;
  outputBytes: number;
  /** Heap ceiling baked in at link time; used to classify allocation failures. */
  memoryLimitBytes: number;
  args?: string[];
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ExecuteOutcome {
  status: RunStatus;
  exitCode: number | null;
  signal: number | null;
  stdout: string;
  stderr: string;
  timeMs: number;
  memoryKb: number;
}

/** Buffers output up to the byte budget so a hostile program cannot grow the heap. */
function collector(limit: number, sink?: (chunk: string) => void) {
  const parts: string[] = [];
  let bytes = 0;
  return {
    push(chunk: string): void {
      if (bytes >= limit) return;
      const remaining = limit - bytes;
      const text = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      bytes += text.length;
      parts.push(text);
      sink?.(text);
    },
    text(): string {
      return parts.join('');
    },
  };
}

export function executeModule(options: ExecuteOptions): Promise<ExecuteOutcome> {
  return new Promise<ExecuteOutcome>((resolve) => {
    const started = performance.now();
    const stdout = collector(options.outputBytes, options.onStdout);
    const stderr = collector(options.outputBytes, options.onStderr);
    const worker = new RunnerWorker({ name: 'cpplab-runner' });

    let settled = false;
    let memoryKb = 0;

    const finish = (outcome: {
      status: RunStatus;
      exitCode: number | null;
      signal: number | null;
      memoryKb: number;
    }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve({
        ...outcome,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timeMs: Math.round(performance.now() - started),
        memoryKb: outcome.memoryKb || memoryKb,
      });
    };

    // The only way to stop a wasm loop that never yields is to kill the Worker.
    const timer = setTimeout(() => {
      finish({ status: 'TLE', exitCode: null, signal: 9, memoryKb });
    }, options.timeMs);

    worker.onmessage = (event: MessageEvent<RunnerEvent>) => {
      const message = event.data;
      switch (message.type) {
        case 'stdout':
          stdout.push(message.data);
          break;
        case 'stderr':
          stderr.push(message.data);
          break;
        case 'exit':
          memoryKb = message.memoryKb;
          finish({
            status: message.code === 0 ? 'OK' : 'RE',
            exitCode: message.code,
            signal: null,
            memoryKb,
          });
          break;
        case 'failure':
          memoryKb = message.memoryKb;
          if (message.message) stderr.push(message.message);
          finish({
            status: message.kind,
            exitCode: null,
            signal: message.kind === 'OLE' ? null : 6,
            memoryKb,
          });
          break;
      }
    };

    worker.onerror = (event) => {
      stderr.push(event.message || 'runner worker crashed');
      finish({ status: 'IE', exitCode: null, signal: null, memoryKb });
    };

    const request: RunnerRequest = {
      type: 'start',
      wasm: toTransferable(options.wasm),
      stdin: options.stdin,
      args: options.args ?? ['program.wasm'],
      outputLimitBytes: options.outputBytes,
      memoryLimitBytes: options.memoryLimitBytes,
    };
    worker.postMessage(request, [request.wasm]);
  });
}

/** Copy into a standalone ArrayBuffer so it can be transferred to the worker. */
function toTransferable(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
