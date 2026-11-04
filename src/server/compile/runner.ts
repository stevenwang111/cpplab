import fs from 'node:fs';
import path from 'node:path';
import type { CompilerId, Diagnostic, OptId, RunStatus, StdId } from '../../shared/types.js';
import { config } from '../config.js';
import { ApiError, SandboxUnavailableError } from '../util/errors.js';
import {
  cleanupWorkdir,
  compileLimits,
  createWorkdir,
  execLimits,
  formatLimits,
  readRunStats,
  runInSandbox,
  timeWrapper,
  withInit,
  writeWorkspaceFiles,
  type SandboxResult,
} from '../sandbox/nsjail.js';
import { buildCompileArgs, compilerExecutable } from './flags.js';
import { parseDiagnostics } from './diagnostics.js';

export interface CompileInput {
  files: Array<{ path: string; content: string }>;
  entry: string;
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  extraFlags: string[];
  debug?: boolean;
}

export interface CompileSuccess {
  ok: true;
  workdir: string;
  compileTimeMs: number;
  warnings: Diagnostic[];
  compileOutput: string;
}

export interface CompileFailure {
  ok: false;
  workdir: string;
  compileTimeMs: number;
  diagnostics: Diagnostic[];
  compileOutput: string;
  sandboxResult: SandboxResult;
}

export type CompileOutcome = CompileSuccess | CompileFailure;

function compilerPath(compiler: CompilerId): string {
  return compilerExecutable(compiler, config.tools.gxx, config.tools.clangxx);
}

export async function compileWorkspace(input: CompileInput): Promise<CompileOutcome> {
  const workdir = createWorkdir();
  writeWorkspaceFiles(workdir, input.files);
  const argv = withInit([
    compilerPath(input.compiler),
    '-I/workspace',
    ...buildCompileArgs({
      compiler: input.compiler,
      std: input.std,
      opt: input.opt,
      debug: input.debug === true,
      extraFlags: input.extraFlags,
      sourcePath: `/workspace/${input.entry}`,
      outputPath: '/workspace/prog',
    }),
  ]);

  const result = await runInSandbox({
    purpose: 'compile',
    workdir,
    argv,
    limits: compileLimits(),
    timeoutMs: config.limits.compileTimeMs,
    outputLimitBytes: config.limits.maxCompileOutputBytes,
  });

  if (result.spawnError) {
    cleanupWorkdir(workdir);
    throw new SandboxUnavailableError('编译沙箱启动失败', result.spawnError);
  }
  if (isSandboxFailure(result)) {
    cleanupWorkdir(workdir);
    throw new SandboxUnavailableError('编译沙箱执行失败', summarizeSandboxFailure(result));
  }

  const parsed = parseDiagnostics(result.stderr);
  if (result.exitCode === 0 && !result.timedOut && !result.outputExceeded) {
    return {
      ok: true,
      workdir,
      compileTimeMs: result.durationMs,
      warnings: parsed.diagnostics,
      compileOutput: result.stderr,
    };
  }

  return {
    ok: false,
    workdir,
    compileTimeMs: result.durationMs,
    diagnostics: parsed.diagnostics,
    compileOutput: result.timedOut
      ? `${result.stderr}\n[编译超时：超过 ${config.limits.compileTimeMs / 1000} 秒]`.trim()
      : result.stderr,
    sandboxResult: result,
  };
}

export interface ExecuteInput {
  timeMs: number;
  memoryMb: number;
  outputBytes: number;
  stdin: string;
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

export async function executeCompiled(workdir: string, input: ExecuteInput): Promise<ExecuteOutcome> {
  const argv = withInit([
    timeWrapper,
    '-q',
    '-o',
    '/workspace/.runstat',
    '-f',
    '%M',
    '/workspace/prog',
  ]);
  const result = await runInSandbox({
    purpose: 'exec',
    workdir,
    argv,
    limits: execLimits(input.timeMs, input.memoryMb),
    timeoutMs: input.timeMs + 250,
    outputLimitBytes: input.outputBytes,
    stdin: input.stdin,
    onStdout: input.onStdout,
    onStderr: input.onStderr,
  });

  if (result.spawnError) {
    throw new SandboxUnavailableError('运行沙箱启动失败', result.spawnError);
  }
  if (isSandboxFailure(result)) {
    throw new SandboxUnavailableError('运行沙箱执行失败', summarizeSandboxFailure(result));
  }

  const stats = readRunStats(workdir);
  let stdout = result.stdout;
  let stderr = result.stderr;
  let status = classifyRun(result, input);

  if (result.timedOut) {
    stdout += `\n[运行超时：超过 ${input.timeMs} ms，进程组已终止]`;
  } else if (result.outputExceeded) {
    stderr += `\n[输出超过 ${(input.outputBytes / 1024).toFixed(0)} KiB，进程组已终止]`;
  } else if (result.sigsys || result.signal === 31) {
    stderr += '\n[沙箱：程序触发了被禁止的系统调用，进程被终止]';
  }

  // A 128+N exit is a signal by convention when nsjail relays the status.
  if (result.exitCode !== null && result.exitCode > 128) {
    status = result.exitCode === 137 ? 'MLE' : 'RE';
  }

  return {
    status,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout,
    stderr,
    timeMs: result.timedOut ? Math.min(result.durationMs, input.timeMs) : result.durationMs,
    memoryKb: stats.memoryKb,
  };
}

function classifyRun(result: SandboxResult, input: ExecuteInput): RunStatus {
  if (result.timedOut) return 'TLE';
  if (result.outputExceeded) return 'OLE';
  if (result.signal === 24 || result.signal === 9) {
    // SIGXCPU is unambiguous; SIGKILL is most often the cgroup OOM killer.
    return result.signal === 24 ? 'TLE' : 'MLE';
  }
  if (result.signal !== null) return 'RE';
  if (result.exitCode === 0) return 'OK';
  if (result.exitCode === 137) return 'MLE';
  if (result.exitCode === 127) return 'IE';
  return 'RE';
}

function isSandboxFailure(result: SandboxResult): boolean {
  if (result.spawnError) return true;
  const log = result.nsjailLog.toLowerCase();
  if (log.includes("couldn't launch") || log.includes('failed to launch') || log.includes('couldn\'t initialize')) {
    return true;
  }
  if (log.includes('couldn’t')) return true;
  if (result.exitCode === 255 && /fatal|error/.test(log)) return true;
  return false;
}

function summarizeSandboxFailure(result: SandboxResult): string {
  const lines = result.nsjailLog
    .split(/\r?\n/)
    .filter((line) => /error|fatal|failed|couldn/i.test(line))
    .slice(-4)
    .join('\n');
  return lines || result.stderr.slice(0, 1000) || 'nsjail 未返回可用结果';
}

export async function formatSource(file: string, content: string): Promise<{ formatted: string; changed: boolean }> {
  if (!config.tools.clangFormat) {
    throw new ApiError(503, 'FORMATTER_UNAVAILABLE', 'clang-format 未安装');
  }
  const normalized = file.replace(/^\/workspace\//, '');
  const workdir = createWorkdir();
  try {
    writeWorkspaceFiles(workdir, [{ path: normalized, content }]);
    const style =
      '{BasedOnStyle: Google, IndentWidth: 4, TabWidth: 4, UseTab: Never, ColumnLimit: 100, ' +
      'AccessModifierOffset: -4, AllowShortFunctionsOnASingleLine: Empty, BreakBeforeBraces: Attach, ' +
      'PointerAlignment: Left, SortIncludes: true}';
    const result = await runInSandbox({
      purpose: 'format',
      workdir,
      argv: withInit([
        config.tools.clangFormat,
        '-i',
        `-style=${style}`,
        `-assume-filename=/workspace/${normalized}`,
        `/workspace/${normalized}`,
      ]),
      limits: formatLimits(),
      timeoutMs: 8_000,
      outputLimitBytes: config.limits.maxOutputBytes,
    });
    if (result.spawnError) {
      throw new SandboxUnavailableError('格式化沙箱启动失败', result.spawnError);
    }
    if (result.timedOut || result.exitCode !== 0) {
      throw new ApiError(400, 'FORMAT_FAILED', 'clang-format 执行失败', result.stderr.slice(0, 2000));
    }
    const formatted = fs.readFileSync(path.join(workdir, ...normalized.split('/')), 'utf8');
    return { formatted, changed: formatted !== content };
  } finally {
    cleanupWorkdir(workdir);
  }
}

