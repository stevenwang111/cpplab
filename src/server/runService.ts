import type { WebSocket } from 'ws';
import type {
  CompilerId,
  Diagnostic,
  OptId,
  RunEvent,
  RunRequest,
  RunResult,
  RunSourceMeta,
  RunStatus,
  StdId,
} from '../shared/types.js';
import { translate, type Locale } from '../shared/i18n/index.js';
import { errorText } from './util/errors.js';
import { compileWorkspace, executeCompiled, type CompileInput } from './compile/runner.js';
import { cleanupWorkdir } from './sandbox/nsjail.js';
import { newId, recordRun } from './db.js';
import { audit } from './util/audit.js';
import { createHash } from 'node:crypto';

import { compileSemaphore, runSemaphore } from './util/semaphores.js';

export interface PreparedRun {
  files: Record<string, string>;
  fileList: Array<{ path: string; content: string }>;
  entry: string;
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  extraFlags: string[];
  stdin: string;
  limits: { timeMs: number; memoryMb: number; outputBytes: number };
  /** UI language captured when the run was requested. */
  locale: Locale;
}

export class RunSession {
  readonly events: RunEvent[] = [];
  readonly listeners = new Set<(event: RunEvent) => void>();
  result?: RunResult;
  done = false;

  constructor(
    readonly id: string,
    readonly createdAt: number,
  ) {}

  emit(event: RunEvent): void {
    if (this.done && event.type !== 'result') return;
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A dead socket must not stop the run.
      }
    }
  }

  finish(result: RunResult): void {
    this.result = result;
    this.done = true;
    this.emit({ type: 'result', result });
    setTimeout(() => sessions.delete(this.id), 10 * 60 * 1000).unref();
  }

  subscribe(listener: (event: RunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replay(): RunEvent[] {
    return [...this.events];
  }
}

const sessions = new Map<string, RunSession>();

export function getRunSession(id: string): RunSession | undefined {
  return sessions.get(id);
}

export function startRun(prepared: PreparedRun): { runId: string } {
  const id = newId();
  const session = new RunSession(id, Date.now());
  sessions.set(id, session);
  void executeRun(session, prepared).catch((error) => {
    const message = errorText(error, prepared.locale);
    const result = buildFailureResult(id, prepared, 'IE', message);
    session.emit({ type: 'error', message });
    session.finish(result);
    try {
      recordRun({ kind: 'run', result, files: prepared.files, stdin: prepared.stdin });
    } catch {
      // Losing one history row is preferable to crashing the process.
    }
  });
  return { runId: id };
}

async function executeRun(session: RunSession, prepared: PreparedRun): Promise<void> {
  const source: RunSourceMeta = {
    entry: prepared.entry,
    compiler: prepared.compiler,
    std: prepared.std,
    opt: prepared.opt,
    extraFlags: prepared.extraFlags,
  };
  const locale = prepared.locale;

  session.emit({ type: 'phase', phase: 'queued', message: translate(locale, 'run.phase.queuedCompile') });
  let releaseCompile: (() => void) | undefined;
  let releaseRun: (() => void) | undefined;
  let workdir: string | undefined;

  try {
    releaseCompile = await compileSemaphore.acquire();
    session.emit({ type: 'phase', phase: 'compiling', message: translate(locale, 'run.phase.compiling') });

    const compileInput: CompileInput = {
      files: prepared.fileList,
      entry: prepared.entry,
      compiler: prepared.compiler,
      std: prepared.std,
      opt: prepared.opt,
      extraFlags: prepared.extraFlags,
      locale,
    };
    const compile = await compileWorkspace(compileInput);
    workdir = compile.workdir;
    releaseCompile();
    releaseCompile = undefined;

    if (!compile.ok) {
      const result: RunResult = {
        id: session.id,
        status: 'CE',
        exitCode: compile.sandboxResult.exitCode,
        signal: compile.sandboxResult.signal,
        stdout: '',
        stderr: compile.compileOutput,
        compileOutput: compile.compileOutput,
        diagnostics: compile.diagnostics,
        timeMs: compile.compileTimeMs,
        compileTimeMs: compile.compileTimeMs,
        memoryKb: 0,
        createdAt: Date.now(),
        source,
      };
      session.emit({ type: 'stderr', data: compile.compileOutput });
      finishRun(session, result, prepared);
      return;
    }

    session.emit({ type: 'phase', phase: 'queued', message: translate(locale, 'run.phase.queuedRun') });
    releaseRun = await runSemaphore.acquire();
    session.emit({ type: 'phase', phase: 'running', message: translate(locale, 'run.phase.running') });

    const outcome = await executeCompiled(workdir, {
      timeMs: prepared.limits.timeMs,
      memoryMb: prepared.limits.memoryMb,
      outputBytes: prepared.limits.outputBytes,
      stdin: prepared.stdin,
      locale,
      onStdout: (data) => session.emit({ type: 'stdout', data }),
      onStderr: (data) => session.emit({ type: 'stderr', data }),
    });

    const result: RunResult = {
      id: session.id,
      status: outcome.status,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      compileOutput: compile.compileOutput,
      diagnostics: compile.warnings,
      timeMs: outcome.timeMs,
      compileTimeMs: compile.compileTimeMs,
      memoryKb: outcome.memoryKb,
      createdAt: Date.now(),
      source,
    };
    session.emit({ type: 'phase', phase: 'finished', message: translate(locale, 'run.phase.finished') });
    finishRun(session, result, prepared);
  } catch (error) {
    const message = errorText(error, locale);
    session.emit({ type: 'error', message });
    const result = buildFailureResult(session.id, prepared, 'IE', message);
    finishRun(session, result, prepared);
  } finally {
    releaseCompile?.();
    releaseRun?.();
    if (workdir) cleanupWorkdir(workdir);
  }
}

function finishRun(session: RunSession, result: RunResult, prepared: PreparedRun): void {
  session.finish(result);
  try {
    recordRun({ kind: 'run', result, files: prepared.files, stdin: prepared.stdin });
  } catch {
    // History is best effort.
  }
  try {
    const hash = createHash('sha256');
    for (const file of Object.keys(prepared.files).sort()) {
      hash.update(file);
      hash.update(prepared.files[file]);
    }
    audit({
      event: 'run.finish',
      runId: session.id,
      status: result.status,
      timeMs: result.timeMs,
      memoryKb: result.memoryKb,
      exitCode: result.exitCode,
      signal: result.signal,
      sourceHash: hash.digest('hex').slice(0, 16),
    });
  } catch {
    // Audit logging is best effort.
  }
}

function buildFailureResult(id: string, prepared: PreparedRun, status: RunStatus, message: string): RunResult {
  return {
    id,
    status,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: message,
    compileOutput: '',
    diagnostics: [],
    timeMs: 0,
    compileTimeMs: 0,
    memoryKb: 0,
    createdAt: Date.now(),
    source: {
      entry: prepared.entry,
      compiler: prepared.compiler,
      std: prepared.std,
      opt: prepared.opt,
      extraFlags: prepared.extraFlags,
    },
  };
}

export function attachRunSocket(session: RunSession, socket: WebSocket): void {
  for (const event of session.replay()) {
    socket.send(JSON.stringify(event));
  }
  if (session.done) {
    socket.close(1000, 'run finished');
    return;
  }
  const unsubscribe = session.subscribe((event) => {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(event));
    if (event.type === 'result') {
      // Let the last frame flush before closing.
      setTimeout(() => socket.close(1000, 'run finished'), 20);
    }
  });
  socket.on('close', unsubscribe);
  socket.on('error', unsubscribe);
}

export function buildPrepared(input: {
  files: Record<string, string>;
  entry: string;
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  extraFlags: string[];
  stdin: string;
  limits: { timeMs: number; memoryMb: number; outputBytes: number };
  locale: Locale;
}): PreparedRun {
  return {
    ...input,
    fileList: Object.entries(input.files).map(([filePath, content]) => ({ path: filePath, content })),
  };
}
