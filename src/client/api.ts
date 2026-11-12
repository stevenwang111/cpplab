/**
 * Local workspace API.
 *
 * This module used to be an HTTP client. It is now the single entry point the
 * UI uses to talk to the browser: IndexedDB for projects/files/history, the
 * wasm toolchain for compiling, and a dedicated Worker for execution. The
 * method names match the old API so the components stayed untouched.
 */
import {
  MAX_FILES,
  MAX_MEMORY_MB,
  MAX_OUTPUT_BYTES,
  MAX_RUN_TIME_MS,
  MAX_SOURCE_BYTES,
  MAX_STDIN_BYTES,
  type RunDetail,
  type RunEvent,
  type RunRequest,
  type RunResult,
  type RunSummary,
  type Project,
  type ProjectState,
} from '../shared/types';
import { detectCapabilities } from './capabilities';
import { t } from './i18n';
import * as store from './storage/db';
import { hexId } from './wasm/constants';
import { executeModule } from './wasm/run/runner';
import { compileWorkspace, formatSource, isFormatterAvailable } from './wasm/toolchain';

export class WorkspaceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Server-side validation, moved into the client so the runner can trust its inputs. */
function validateRequest(request: RunRequest): { timeMs: number; memoryMb: number; outputBytes: number; stdin: string } {
  const files = Object.entries(request.files);
  if (files.length === 0) throw new WorkspaceError('NO_FILES', t('app.error.noFiles'));
  if (files.length > MAX_FILES) throw new WorkspaceError('TOO_MANY_FILES', t('app.error.tooManyFiles', { max: MAX_FILES }));
  for (const [path, content] of files) {
    if (new TextEncoder().encode(content).length > MAX_SOURCE_BYTES) {
      throw new WorkspaceError('FILE_TOO_LARGE', t('app.error.fileTooLarge', { file: path }));
    }
  }
  if (!request.files[request.entry]) {
    throw new WorkspaceError('ENTRY_MISSING', t('app.error.entryMissing', { entry: request.entry }));
  }

  return {
    timeMs: clamp(request.limits?.timeMs ?? 2000, 200, MAX_RUN_TIME_MS, 2000),
    memoryMb: clamp(request.limits?.memoryMb ?? 256, 64, MAX_MEMORY_MB, 256),
    outputBytes: clamp(request.limits?.outputBytes ?? MAX_OUTPUT_BYTES, 1024, MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES),
    stdin: (request.stdin ?? '').slice(0, MAX_STDIN_BYTES),
  };
}

function sourceBytes(files: Record<string, string>): number {
  return Object.entries(files).reduce(
    (total, [path, content]) => total + path.length + new TextEncoder().encode(content).length,
    0,
  );
}

export interface RunHandlers {
  onEvent?: (event: RunEvent) => void;
}

export const api = {
  async project(): Promise<ProjectState> {
    // Sequential on purpose: the very first call seeds the starter file, and
    // listing the store in parallel would race with that write.
    const project = await store.getProject();
    const files = await store.listFiles();
    return { project, files, capabilities: detectCapabilities() };
  },

  async updateProject(patch: { settings?: Partial<Project['settings']>; name?: string }): Promise<{ project: Project }> {
    const project = await store.updateProject(patch.settings ?? {}, patch.name);
    return { project };
  },

  async saveFile(path: string, content: string): Promise<{ ok: boolean }> {
    if (new TextEncoder().encode(content).length > MAX_SOURCE_BYTES) {
      throw new WorkspaceError('FILE_TOO_LARGE', t('app.error.fileTooLarge', { file: path }));
    }
    await store.putFile(path, content);
    return { ok: true };
  },

  async deleteFile(path: string): Promise<{ ok: boolean }> {
    await store.deleteFileRow(path);
    return { ok: true };
  },

  async format(file: string, content: string): Promise<{ formatted: string; changed: boolean }> {
    if (!(await isFormatterAvailable())) {
      throw new WorkspaceError('FORMATTER_UNAVAILABLE', t('app.error.formatUnavailable'));
    }
    return formatSource(file, content);
  },

  async formatterAvailable(): Promise<boolean> {
    return isFormatterAvailable();
  },

  /**
   * Compile and run. Progress is delivered through `onEvent` with the same
   * event shape the WebSocket bridge used, so the UI reducer is unchanged.
   */
  async run(request: RunRequest, handlers: RunHandlers = {}): Promise<RunResult> {
    const emit = (event: RunEvent): void => handlers.onEvent?.(event);
    const limits = validateRequest(request);
    const id = hexId(8);
    const source = {
      entry: request.entry,
      compiler: request.compiler,
      std: request.std,
      opt: request.opt,
      extraFlags: request.extraFlags ?? [],
    };

    emit({ type: 'phase', phase: 'queued', message: t('app.run.phase.preparing') });
    emit({ type: 'phase', phase: 'compiling', message: t('app.run.phase.compiling') });

    const compiled = await compileWorkspace({
      files: request.files,
      entry: request.entry,
      std: request.std,
      opt: request.opt,
      extraFlags: request.extraFlags ?? [],
      memoryMb: limits.memoryMb,
      onPhase: (phase) => {
        const messages: Record<'prepare' | 'compile' | 'link', string> = {
          prepare: t('app.run.phase.prepare'),
          compile: t('app.run.phase.compiling'),
          link: t('app.run.phase.linking'),
        };
        emit({ type: 'phase', phase: 'compiling', message: messages[phase] });
      },
      onOutput: (text) => emit({ type: 'stderr', data: text }),
    });

    if (!compiled.ok) {
      const result: RunResult = {
        id,
        status: 'CE',
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: compiled.compileOutput,
        compileOutput: compiled.compileOutput,
        diagnostics: compiled.diagnostics,
        timeMs: compiled.compileTimeMs,
        compileTimeMs: compiled.compileTimeMs,
        memoryKb: 0,
        createdAt: Date.now(),
        source,
      };
      await record(result, request, limits.stdin);
      emit({ type: 'result', result });
      return result;
    }

    emit({ type: 'phase', phase: 'running', message: t('app.run.phase.running') });
    const outcome = await executeModule({
      wasm: compiled.module,
      stdin: limits.stdin,
      timeMs: limits.timeMs,
      outputBytes: limits.outputBytes,
      memoryLimitBytes: limits.memoryMb * 1024 * 1024,
      onStdout: (data) => emit({ type: 'stdout', data }),
      onStderr: (data) => emit({ type: 'stderr', data }),
    });

    let stderr = outcome.stderr;
    if (outcome.status === 'TLE') stderr = `${stderr}\n${t('app.run.note.timeout', { ms: limits.timeMs })}`.trim();
    if (outcome.status === 'OLE') {
      stderr = `${stderr}\n${t('app.run.note.outputLimit', { kb: Math.floor(limits.outputBytes / 1024) })}`.trim();
    }
    if (outcome.status === 'MLE') {
      stderr = `${stderr}\n${t('app.run.note.memoryLimit', { mb: limits.memoryMb })}`.trim();
    }
    if (outcome.status === 'RE') {
      // A trap kills the module before it can report anything readable; a plain
      // non-zero return is self-explanatory once the code is spelled out.
      stderr =
        outcome.exitCode === null
          ? `${stderr}\n${t('app.run.note.abort')}`.trim()
          : `${stderr}\n${t('app.run.note.exitCode', { code: outcome.exitCode })}`.trim();
    }

    const result: RunResult = {
      id,
      status: outcome.status,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: outcome.stdout,
      stderr,
      compileOutput: compiled.compileOutput,
      diagnostics: compiled.diagnostics.filter((item) => item.severity !== 'error'),
      timeMs: outcome.timeMs,
      compileTimeMs: compiled.compileTimeMs,
      memoryKb: outcome.memoryKb,
      createdAt: Date.now(),
      source,
    };

    emit({ type: 'phase', phase: 'finished', message: t('app.run.phase.finished') });
    await record(result, request, limits.stdin);
    emit({ type: 'result', result });
    return result;
  },

  async runs(limit = 40): Promise<{ runs: RunSummary[] }> {
    return { runs: await store.listRuns(limit) };
  },

  async runDetail(id: string): Promise<{ run: RunDetail }> {
    const run = await store.getRun(id);
    if (!run) throw new WorkspaceError('RUN_NOT_FOUND', t('app.error.runNotFound'));
    return { run };
  },

  async restoreRun(id: string): Promise<ProjectState> {
    const run = await store.getRun(id);
    if (!run) throw new WorkspaceError('RUN_NOT_FOUND', t('app.error.runNotFound'));
    await store.replaceFiles(run.files);
    const project = await store.updateProject(
      {
        entry: run.files[run.source.entry] ? run.source.entry : (Object.keys(run.files)[0] ?? 'main.cpp'),
        compiler: run.source.compiler,
        std: run.source.std,
        opt: run.source.opt,
      },
      undefined,
    );
    const files = await store.listFiles();
    return { project, files, capabilities: detectCapabilities() };
  },
};

async function record(result: RunResult, request: RunRequest, stdin: string): Promise<void> {
  try {
    await store.insertRun({
      run: { ...result, files: request.files, stdin },
      sourceBytes: sourceBytes(request.files),
    });
  } catch {
    // History is best effort; a full quota must not fail the run itself.
  }
}
