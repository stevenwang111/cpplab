/** Messages exchanged with the WebAssembly runner worker. */

export interface RunnerRequest {
  type: 'start';
  wasm: ArrayBuffer;
  stdin: string;
  args: string[];
  outputLimitBytes: number;
  /**
   * Heap ceiling baked into the module by `wasm-ld --max-memory`. Used to tell
   * "ran out of memory" apart from an ordinary trap: a failed allocation
   * surfaces as a bare `unreachable` abort, but only after the heap has been
   * grown all the way to this value.
   */
  memoryLimitBytes: number;
}

export type RunnerFailureKind = 'RE' | 'MLE' | 'OLE' | 'IE';

export type RunnerEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number; memoryKb: number }
  | { type: 'failure'; kind: RunnerFailureKind; message: string; memoryKb: number };
