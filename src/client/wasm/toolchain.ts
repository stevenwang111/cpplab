/**
 * In-browser C++ toolchain (compile only).
 *
 * Everything here runs client-side: clang and wasm-ld are WebAssembly modules
 * executed inside a dedicated Worker, the workspace is a virtual filesystem,
 * and the only thing that leaves the Worker is the linked wasm module.
 *
 * Boot is lazy and paid once per page: the first `ensureReady()` fetches the
 * pinned toolchain manifest and lets the worker pull the `llvm` bundle
 * (~41 MB brotli) on first use. Call `warmup()` from an idle callback to hide
 * that latency behind the user typing.
 */
import { WorkerOrchestrator, workerTransport, type WorkerToolResult } from 'emception';
import type { Diagnostic } from '../../shared/types';
import { t } from '../i18n';
import ToolchainWorker from './toolchain.worker?worker';
import {
  COMPILE_BUNDLES,
  OBJECT_DIR,
  PROGRAM_PATH,
  TOOLCHAIN_MANIFEST_URL,
  WORKSPACE_ROOT,
  isSourceFile,
} from './constants';
import { basename, compileArgv, linkArgv, sanitizeExtraFlags } from './flags';
import { parseDiagnostics } from './diagnostics';

const COMPILE_TIMEOUT_MS = 180_000;
const LINK_TIMEOUT_MS = 120_000;

export interface ToolchainCompileRequest {
  files: Record<string, string>;
  entry: string;
  std: import('../../shared/types').StdId;
  opt: import('../../shared/types').OptId;
  extraFlags: string[];
  memoryMb: number;
  onPhase?: (phase: 'prepare' | 'compile' | 'link') => void;
  onOutput?: (text: string) => void;
}

export interface ToolchainCompileSuccess {
  ok: true;
  module: Uint8Array;
  diagnostics: Diagnostic[];
  compileOutput: string;
  compileTimeMs: number;
}

export interface ToolchainCompileFailure {
  ok: false;
  diagnostics: Diagnostic[];
  compileOutput: string;
  compileTimeMs: number;
}

export type ToolchainCompileOutcome = ToolchainCompileSuccess | ToolchainCompileFailure;

export class ToolchainError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ToolchainError';
  }
}

interface PendingBoot {
  worker: Worker;
  orchestrator: WorkerOrchestrator;
}

let pendingBoot: Promise<PendingBoot> | null = null;
let booted: PendingBoot | null = null;
let formatterSupport: boolean | null = null;

async function boot(): Promise<PendingBoot> {
  if (booted) return booted;
  if (pendingBoot) return pendingBoot;

  pendingBoot = (async () => {
    const worker = new ToolchainWorker({ name: 'cpplab-toolchain' });
    const orchestrator = new WorkerOrchestrator(workerTransport(worker));
    try {
      await orchestrator.boot(TOOLCHAIN_MANIFEST_URL, { origin: location.origin });
    } catch (error) {
      // A failed boot leaves the worker unusable; drop it so the user can retry.
      await orchestrator.dispose(error).catch(() => undefined);
      pendingBoot = null;
      throw new ToolchainError(
        t('app.error.toolchainBootFailed'),
        error instanceof Error ? error.message : String(error),
      );
    }
    booted = { worker, orchestrator };
    return booted;
  })();

  return pendingBoot;
}

function requireBooted(): PendingBoot {
  if (!booted) throw new ToolchainError(t('app.error.toolchainNotReady'));
  return booted;
}

/** True once the worker handshake completed (bundles may still be cold). */
export function isToolchainReady(): boolean {
  return booted !== null;
}

/** Shut the worker down; used by HMR and when the page is discarded. */
export function disposeToolchain(): void {
  if (!booted) return;
  const { orchestrator } = booted;
  booted = null;
  pendingBoot = null;
  formatterSupport = null;
  void orchestrator.dispose().catch(() => undefined);
}

/** Bumped while a build is pending so the idle warmup can step aside. */
let buildDemand = 0;

/**
 * Prefetch the toolchain while the user is idle. Runs a tiny clang command so
 * the worker resolves the `llvm` bundle into its cache; the result is ignored.
 *
 * If a build is requested before the warmup gets its turn, the warmup is
 * skipped instead of making the user wait behind a pointless `--version`.
 */
export async function warmup(): Promise<void> {
  try {
    const { orchestrator } = await boot();
    await runTool(orchestrator, 'clang', ['clang', '--version'], {
      timeoutMs: 120_000,
      cwd: WORKSPACE_ROOT,
      skipIf: () => buildDemand > 0,
    });
  } catch {
    // Warmup is an optimisation; the real run surfaces any problem.
  }
}

/**
 * Serialises tool invocations.
 *
 * The worker runs one tool process at a time against a single VFS, so the idle
 * warmup (`clang --version`) and a user-triggered build must not overlap: the
 * second process would otherwise start against a half-written workspace and pay
 * for a second copy of the 21 MB clang module that is still being loaded.
 */
let toolQueue: Promise<unknown> = Promise.resolve();

function withToolLock<T>(task: () => Promise<T>): Promise<T> {
  const run = toolQueue.then(task, task);
  toolQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runTool(
  orchestrator: WorkerOrchestrator,
  tool: string,
  argv: string[],
  options: {
    cwd?: string;
    timeoutMs: number;
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
    /** Checked once the queue slot is free; returning true skips the call. */
    skipIf?: () => boolean;
  },
): Promise<WorkerToolResult> {
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolchainError(t('app.error.toolchainTimeout', { tool })));
    }, options.timeoutMs);
    void timer;
  });

  return withToolLock(() => {
    if (options.skipIf?.()) {
      return Promise.resolve<WorkerToolResult>({
        exitCode: -1,
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
      });
    }
    return Promise.race([
      orchestrator.run(tool, argv, {
        cwd: options.cwd ?? WORKSPACE_ROOT,
        hints: { bundlesNeeded: [...COMPILE_BUNDLES] },
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      }),
      timeout,
    ]);
  });
}

/** Rewrite the workspace so it contains exactly `files`. */
async function syncWorkspace(orchestrator: WorkerOrchestrator, files: Record<string, string>): Promise<void> {
  await orchestrator.resetVfs();
  const encoder = new TextEncoder();
  for (const [path, content] of Object.entries(files)) {
    await orchestrator.writeFile(`${WORKSPACE_ROOT}/${path}`, encoder.encode(content));
  }
}

/**
 * Compile every translation unit and link them into a single WASI module.
 *
 * Multi-file projects follow the same shape as a normal build: one object per
 * source file, then one `wasm-ld` invocation. The whole compile is reported as
 * a CE with parsed diagnostics as soon as one translation unit fails.
 */
export async function compileWorkspace(request: ToolchainCompileRequest): Promise<ToolchainCompileOutcome> {
  buildDemand += 1;
  try {
    return await compileWorkspaceOnce(request);
  } finally {
    buildDemand -= 1;
  }
}

async function compileWorkspaceOnce(request: ToolchainCompileRequest): Promise<ToolchainCompileOutcome> {
  const started = performance.now();
  const extraFlags = sanitizeExtraFlags(request.extraFlags);
  const { orchestrator } = await boot();

  const sources = Object.keys(request.files)
    .filter(isSourceFile)
    .sort((a, b) => {
      if (a === request.entry) return -1;
      if (b === request.entry) return 1;
      return a.localeCompare(b);
    });

  if (sources.length === 0) {
    return {
      ok: false,
      diagnostics: [],
      compileOutput: t('app.error.noSourceFiles', { entry: request.entry }),
      compileTimeMs: 0,
    };
  }

  request.onPhase?.('prepare');
  await syncWorkspace(orchestrator, request.files);

  const objects: string[] = [];
  // The worker streams stdout/stderr one *line* at a time, without the
  // trailing newline — a terminal sink, not a byte stream. Joining with an
  // empty string would glue every diagnostic into one unparsable line.
  const outputLines: string[] = [];
  const pushOutput = (text: string): void => {
    if (!text) return;
    outputLines.push(text);
    request.onOutput?.(`${text}\n`);
  };

  request.onPhase?.('compile');
  for (const source of sources) {
    const objectPath = `${OBJECT_DIR}/${objectName(source)}`;
    const result = await runTool(
      orchestrator,
      'clang',
      compileArgv({
        std: request.std,
        opt: request.opt,
        extraFlags,
        sourcePath: `${WORKSPACE_ROOT}/${source}`,
        objectPath,
      }),
      {
        timeoutMs: COMPILE_TIMEOUT_MS,
        onStdout: pushOutput,
        onStderr: pushOutput,
      },
    );

    if (result.timedOut) {
      return {
        ok: false,
        diagnostics: parseDiagnostics(result.stderr).diagnostics,
        compileOutput: `${outputLines.join('\n')}\n${t('app.error.compileTimeout')}`.trim(),
        compileTimeMs: Math.round(performance.now() - started),
      };
    }
    if (result.exitCode !== 0) {
      // A non-zero exit with no output means the failure happened before clang
      // could report anything (argument rejection, missing file, crash). Say so
      // explicitly instead of showing an empty panel.
      const combined =
        outputLines.join('\n') ||
        result.stderr ||
        t('app.error.compileFailedNoOutput', { code: result.exitCode });
      return {
        ok: false,
        diagnostics: parseDiagnostics(combined).diagnostics,
        compileOutput: combined,
        compileTimeMs: Math.round(performance.now() - started),
      };
    }
    objects.push(objectPath);
  }

  request.onPhase?.('link');
  const link = await runTool(orchestrator, 'wasm-ld', linkArgv(objects, PROGRAM_PATH, request.memoryMb), {
    timeoutMs: LINK_TIMEOUT_MS,
    onStdout: pushOutput,
    onStderr: pushOutput,
  });

  const combined = outputLines.join('\n');
  if (link.exitCode !== 0 || link.timedOut) {
    const output = link.timedOut
      ? `${combined}\n${t('app.error.compileTimeout')}`.trim()
      : combined || link.stderr || t('app.error.linkFailedNoOutput', { code: link.exitCode });
    return {
      ok: false,
      diagnostics: parseDiagnostics(output).diagnostics,
      compileOutput: output,
      compileTimeMs: Math.round(performance.now() - started),
    };
  }

  const module = await orchestrator.getFile(PROGRAM_PATH);
  if (!module || module.byteLength === 0) {
    return {
      ok: false,
      diagnostics: [],
      compileOutput: `${combined}\n${t('app.error.linkOutputMissing')}`.trim(),
      compileTimeMs: Math.round(performance.now() - started),
    };
  }

  return {
    ok: true,
    module,
    diagnostics: parseDiagnostics(combined).diagnostics,
    compileOutput: combined,
    compileTimeMs: Math.round(performance.now() - started),
  };
}

/**
 * clang-format is not part of the pinned toolchain bundle yet. The capability
 * probe keeps the UI honest and starts working the moment the artifact ships.
 */
export async function isFormatterAvailable(): Promise<boolean> {
  if (formatterSupport !== null) return formatterSupport;
  try {
    const { orchestrator } = await boot();
    const result = await runTool(orchestrator, 'clang-format', ['clang-format', '--version'], {
      timeoutMs: 15_000,
    });
    formatterSupport = result.exitCode === 0;
  } catch {
    formatterSupport = false;
  }
  return formatterSupport;
}

const FORMAT_STYLE =
  '{BasedOnStyle: Google, IndentWidth: 4, TabWidth: 4, UseTab: Never, ColumnLimit: 100, ' +
  'AccessModifierOffset: -4, AllowShortFunctionsOnASingleLine: Empty, BreakBeforeBraces: Attach, ' +
  'PointerAlignment: Left, SortIncludes: true}';

export async function formatSource(file: string, content: string): Promise<{ formatted: string; changed: boolean }> {
  if (!(await isFormatterAvailable())) {
    throw new ToolchainError(t('app.error.formatUnavailable'));
  }
  const { orchestrator } = await boot();
  const path = `${WORKSPACE_ROOT}/${file}`;
  await orchestrator.writeFile(path, new TextEncoder().encode(content));
  const result = await runTool(orchestrator, 'clang-format', ['clang-format', `-style=${FORMAT_STYLE}`, path], {
    timeoutMs: 20_000,
    cwd: WORKSPACE_ROOT,
  });
  if (result.exitCode !== 0) {
    throw new ToolchainError(t('app.error.formatFailed'), result.stderr.slice(0, 2000));
  }
  const formatted = result.stdout;
  return { formatted, changed: formatted !== content };
}

function objectName(source: string): string {
  const name = basename(source).replace(/\.(cpp|cc|cxx|c\+\+|C|cp)$/, '');
  const prefix = source.slice(0, source.length - basename(source).length).replace(/[^A-Za-z0-9]/g, '_');
  return `${prefix}${name}.o`;
}
