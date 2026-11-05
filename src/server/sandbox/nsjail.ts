import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { config } from '../config.js';
import { ApiError, SandboxUnavailableError, msg, raw } from '../util/errors.js';
import { checkDevices } from './rootfs.js';

export type SandboxPurpose = 'compile' | 'exec' | 'debug' | 'format';

export interface SandboxLimits {
  timeLimitSec: number;
  cpuSec: number;
  memoryMb: number;
  pidsMax: number;
  fsizeMb: number;
  nofile: number;
  tmpfsMb: number;
  shmMb: number;
  cpuMsPerSec: number;
}

export interface SandboxExecuteOptions {
  purpose: SandboxPurpose;
  workdir: string;
  argv: string[];
  limits: SandboxLimits;
  timeoutMs: number;
  outputLimitBytes: number;
  stdin?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SandboxResult {
  exitCode: number | null;
  signal: number | null;
  timedOut: boolean;
  outputExceeded: boolean;
  sigsys: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  nsjailLog: string;
  spawnError?: string;
}

export interface DebugSandboxHandle {
  child: ChildProcess;
  logPath: string;
  configPath: string;
  cleanup: () => void;
  readLog: () => string;
}

const TEMPLATE_BY_PURPOSE: Record<SandboxPurpose, string> = {
  compile: 'compile.cfg',
  exec: 'exec.cfg',
  debug: 'debug.cfg',
  format: 'compile.cfg',
};

const DEV_NAMES = ['null', 'zero', 'urandom', 'random'];

export function assertSandboxReady(): void {
  if (!config.sandbox.nsjailPath) {
    throw new SandboxUnavailableError(msg('caps.nsjailMissing'), msg('caps.nsjailSetupHint'));
  }
  try {
    const stat = fs.statSync(config.sandbox.nsjailPath);
    const setuid = (stat.mode & 0o4000) !== 0;
    if (process.getuid?.() !== 0 && !setuid) {
      throw new SandboxUnavailableError(msg('caps.nsjailPermission'), msg('caps.nsjailPermissionHint'));
    }
  } catch (error) {
    if (error instanceof SandboxUnavailableError) throw error;
    throw new SandboxUnavailableError(msg('caps.nsjailStatFailed'), raw(String(error)));
  }

  // F-01: the sandbox identity must be disjoint from the service user, else a
  // file-system escape is immediately a service-user compromise.
  const serviceUid = process.getuid?.();
  if (serviceUid !== undefined && serviceUid === config.sandbox.uid) {
    throw new SandboxUnavailableError(
      msg('caps.nsjailPermission'),
      raw(`SANDBOX_UID (${config.sandbox.uid}) must differ from the service uid (${serviceUid})`),
    );
  }

  const devices = checkDevices();
  if (!devices.ready) {
    throw new SandboxUnavailableError(msg('caps.nsjailDevicesNotReady'), devices.detail);
  }

  fs.mkdirSync(config.sandbox.runtimeDir, { recursive: true, mode: 0o755 });
  fs.mkdirSync(path.join(config.sandbox.runtimeDir, 'config'), { recursive: true, mode: 0o755 });
  fs.mkdirSync(config.sandbox.logDir, { recursive: true, mode: 0o755 });
  fs.mkdirSync(config.workRoot, { recursive: true, mode: 0o755 });
}

export function compileLimits(): SandboxLimits {
  return {
    timeLimitSec: 21,
    cpuSec: 21,
    memoryMb: 1024,
    pidsMax: 64,
    fsizeMb: 256,
    nofile: 256,
    tmpfsMb: 64,
    shmMb: 64,
    cpuMsPerSec: 1000,
  };
}

export function execLimits(timeMs: number, memoryMb: number): SandboxLimits {
  const seconds = Math.max(1, Math.ceil(timeMs / 1000) + 1);
  return {
    timeLimitSec: seconds,
    cpuSec: seconds,
    memoryMb,
    pidsMax: 14,
    fsizeMb: 16,
    nofile: 100,
    tmpfsMb: 32,
    shmMb: 16,
    cpuMsPerSec: 500,
  };
}

export function debugLimits(): SandboxLimits {
  return {
    timeLimitSec: config.debug.timeLimitSec,
    cpuSec: config.debug.timeLimitSec,
    memoryMb: config.debug.memoryMb,
    pidsMax: config.debug.pidsMax,
    fsizeMb: 1024,
    nofile: 256,
    tmpfsMb: 512,
    shmMb: 256,
    cpuMsPerSec: 1000,
  };
}

export function formatLimits(): SandboxLimits {
  return {
    timeLimitSec: 10,
    cpuSec: 10,
    memoryMb: 512,
    pidsMax: 64,
    fsizeMb: 16,
    nofile: 100,
    tmpfsMb: 32,
    shmMb: 16,
    cpuMsPerSec: 1000,
  };
}

export function createWorkdir(): string {
  fs.mkdirSync(config.workRoot, { recursive: true, mode: 0o755 });
  const workdir = fs.mkdtempSync(path.join(config.workRoot, 'cpplab-'));
  fs.chmodSync(workdir, 0o777);
  return workdir;
}

export function writeWorkspaceFiles(workdir: string, files: Array<{ path: string; content: string }>): void {
  for (const file of files) {
    const target = path.join(workdir, ...file.path.split('/'));
    const relative = path.relative(workdir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ApiError(400, 'INVALID_PATH', msg('err.workspaceEscape', { path: file.path }));
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    // Defense-in-depth: never follow a symlink out of the workdir, even though
    // the directory is freshly created and currently empty.
    const fd = fs.openSync(
      target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
      0o644,
    );
    try {
      fs.writeFileSync(fd, file.content);
    } finally {
      fs.closeSync(fd);
    }
  }
}

export function cleanupWorkdir(workdir: string): void {
  try {
    fs.rmSync(workdir, { recursive: true, force: true });
  } catch {
    // Best effort: an open debugger or leaked process may keep a file alive.
  }
}

function materializeConfig(purpose: SandboxPurpose, limits: SandboxLimits): string {
  const templatePath = path.join(config.sandbox.configDir, TEMPLATE_BY_PURPOSE[purpose]);
  let template = fs.readFileSync(templatePath, 'utf8');
  const replacements: Record<string, string> = {
    '{{TIME_LIMIT}}': String(limits.timeLimitSec),
    '{{CPU_SEC}}': String(limits.cpuSec),
    '{{MEM_BYTES}}': String(limits.memoryMb * 1024 * 1024),
    '{{PIDS_MAX}}': String(limits.pidsMax),
    '{{FSIZE_BYTES}}': String(limits.fsizeMb * 1024 * 1024),
    '{{NOFILE}}': String(limits.nofile),
    '{{TMPFS_MB}}': String(limits.tmpfsMb),
    '{{SHM_MB}}': String(limits.shmMb),
    '{{CPU_MS}}': String(limits.cpuMsPerSec),
    '{{DEV_DIR}}': config.sandbox.devDir,
  };
  for (const [key, value] of Object.entries(replacements)) {
    template = template.split(key).join(value);
  }
  const configPath = path.join(config.sandbox.runtimeDir, 'config', `${purpose}-${randomUUID()}.cfg`);
  fs.writeFileSync(configPath, template, { mode: 0o600 });
  return configPath;
}

function buildArgs(configPath: string, workdir: string, logPath: string, argv: string[]): string[] {
  // NOTE: options placed before --config are reset when the config file is
  // parsed, so every flag must come after --config.
  //
  // No --rw: the chroot rootfs is mounted read-only (F-02).
  // --disable_clone_newuser: with a setuid-root nsjail the user namespace would
  // map the sandbox uid onto the service user on the host (F-01). Dropping the
  // user namespace makes --user/--group the *real* host uid/gid, which is a
  // dedicated non-service identity.
  return [
    '--config',
    configPath,
    '--experimental_mnt',
    'old',
    '--disable_clone_newuser',
    '--chroot',
    config.sandbox.rootfsDir,
    '--bindmount',
    `${workdir}:/workspace`,
    '--cwd',
    '/workspace',
    '--user',
    String(config.sandbox.uid),
    '--group',
    String(config.sandbox.gid),
    '--log',
    logPath,
    '--',
    ...argv,
  ];
}

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already gone or owned by another user.
  }
}

function readLog(logPath: string): string {
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Kill the nsjail process and every visible descendant. A plain
 * `kill(child.pid)` leaves the pid-namespace init alive on some kernels, so the
 * /proc walk is part of the cleanup, not a debugging aid.
 */
function terminateTree(rootPid: number, signal: NodeJS.Signals): void {
  const parents = new Map<number, number>();
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const match = /^PPid:\s+(\d+)$/m.exec(status);
        if (match) parents.set(pid, Number(match[1]));
      } catch {
        // Process disappeared between readdir and read.
      }
    }
    const targets = new Set<number>([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, ppid] of parents) {
        if (targets.has(ppid) && !targets.has(pid)) {
          targets.add(pid);
          changed = true;
        }
      }
    }
    for (const pid of targets) {
      try {
        process.kill(pid, signal);
      } catch {
        // Already exited.
      }
    }
  } catch {
    try {
      process.kill(rootPid, signal);
    } catch {
      // Already exited.
    }
  }
}

function killSandbox(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already exited.
    }
  }
  terminateTree(child.pid, 'SIGTERM');
  const killTimer = setTimeout(() => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already exited.
    }
    terminateTree(child.pid, 'SIGKILL');
  }, 180);
  killTimer.unref();
}

function normalizeExit(code: number | null, signal: NodeJS.Signals | null): {
  exitCode: number | null;
  signal: number | null;
} {
  if (signal) {
    return { exitCode: null, signal: signalNumber(signal) };
  }
  if (code !== null && code > 128 && code <= 160) {
    return { exitCode: null, signal: code - 128 };
  }
  return { exitCode: code, signal: null };
}

function signalNumber(signal: NodeJS.Signals): number {
  const signals: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGBUS: 7,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGUSR1: 10,
    SIGSEGV: 11,
    SIGUSR2: 12,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
    SIGXCPU: 24,
    SIGSYS: 31,
  };
  return signals[signal] ?? 0;
}

/**
 * Fork nsjail with umask 0 so every file the sandboxed uid creates in the
 * workdir is world-writable. The workdir is afterwards removed by the service
 * user; with a normal umask the sandbox uid would create 0755 nested
 * directories the host cannot delete into (disk leak).
 */
function spawnSandbox(args: string[]): ChildProcess {
  const previousUmask = process.umask(0);
  try {
    return spawn(config.sandbox.nsjailPath!, args, {
      cwd: config.projectRoot,
      detached: true,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } finally {
    process.umask(previousUmask);
  }
}

/**
 * Run a command inside a throwaway jail. Output is capped in the parent; when
 * either limit trips the whole process tree is terminated.
 */
export async function runInSandbox(options: SandboxExecuteOptions): Promise<SandboxResult> {
  assertSandboxReady();
  const configPath = materializeConfig(options.purpose, options.limits);
  const logPath = path.join(config.sandbox.logDir, `${options.purpose}-${randomUUID()}.log`);
  const args = buildArgs(configPath, options.workdir, logPath, options.argv);
  const startedAt = Date.now();

  let child: ChildProcess;
  try {
    child = spawnSandbox(args);
  } catch (error) {
    safeUnlink(configPath);
    throw new SandboxUnavailableError(msg('caps.nsjailStartFailed'), raw(String(error)));
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let captured = 0;
  let outputExceeded = false;
  let timedOut = false;
  let streaming = true;
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');

  const stop = (reason: 'timeout' | 'output'): void => {
    if (reason === 'timeout') timedOut = true;
    if (reason === 'output') outputExceeded = true;
    killSandbox(child);
  };

  const timer = setTimeout(() => {
    if (streaming) stop('timeout');
  }, options.timeoutMs);
  timer.unref();

  child.stdout?.on('data', (chunk: Buffer) => {
    if (!streaming) return;
    const room = options.outputLimitBytes - captured;
    if (room > 0) {
      const taken = chunk.subarray(0, room);
      stdoutChunks.push(taken);
      captured += taken.length;
      if (options.onStdout) {
        const text = stdoutDecoder.write(taken);
        if (text) options.onStdout(text);
      }
      if (taken.length < chunk.length) {
        outputExceeded = true;
        stop('output');
      }
    } else {
      outputExceeded = true;
      stop('output');
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    if (!streaming) return;
    const room = options.outputLimitBytes - captured;
    if (room > 0) {
      const taken = chunk.subarray(0, room);
      stderrChunks.push(taken);
      captured += taken.length;
      if (options.onStderr) {
        const text = stderrDecoder.write(taken);
        if (text) options.onStderr(text);
      }
      if (taken.length < chunk.length) {
        outputExceeded = true;
        stop('output');
      }
    } else {
      outputExceeded = true;
      stop('output');
    }
  });

  if (options.stdin) {
    const payload = options.stdin.length > 1024 * 1024 ? options.stdin.slice(0, 1024 * 1024) : options.stdin;
    child.stdin?.on('error', () => {
      // A program that never reads stdin closes the pipe early.
    });
    child.stdin?.end(payload);
  } else {
    child.stdin?.end();
  }

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: string }>(
    (resolve) => {
      child.once('error', (error) => resolve({ code: null, signal: null, error: String(error) }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );

  const exit = await closed;
  streaming = false;
  clearTimeout(timer);

  // Give nsjail a moment to flush its own log file before reading it.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const nsjailLog = readLog(logPath);
  safeUnlink(configPath);
  safeUnlink(logPath);

  const extraStdout = stdoutDecoder.end();
  const extraStderr = stderrDecoder.end();
  const status = normalizeExit(exit.code, exit.signal);

  return {
    ...status,
    timedOut,
    outputExceeded,
    sigsys: /SIGSYS|seccomp violation/i.test(nsjailLog),
    stdout: Buffer.concat(stdoutChunks).toString('utf8') + extraStdout,
    stderr: Buffer.concat(stderrChunks).toString('utf8') + extraStderr,
    durationMs: Date.now() - startedAt,
    nsjailLog,
    spawnError: exit.error,
  };
}

/** Start a long-lived jail process for the DAP bridge. */
export function startDebugSandbox(workdir: string, argv: string[]): DebugSandboxHandle {
  assertSandboxReady();
  const limits = debugLimits();
  const configPath = materializeConfig('debug', limits);
  const logPath = path.join(config.sandbox.logDir, `debug-${randomUUID()}.log`);
  const args = buildArgs(configPath, workdir, logPath, argv);

  const child = spawnSandbox(args);

  child.on('error', () => {
    // The session layer observes the close event and reports the failure.
  });

  return {
    child,
    logPath,
    configPath,
    cleanup: () => {
      safeUnlink(configPath);
      safeUnlink(logPath);
    },
    readLog: () => readLog(logPath),
  };
}

export function terminateDebugSandbox(handle: DebugSandboxHandle): void {
  killSandbox(handle.child);
}

export function readRunStats(workdir: string): { memoryKb: number; cpuMs: number } {
  const statsPath = path.join(workdir, '.runstat');
  try {
    // The file is created inside an untrusted workspace and can be replaced by
    // anything the sandboxed program leaves behind. O_NOFOLLOW blocks crafted
    // symlinks, O_NONBLOCK keeps a FIFO from blocking the Node event loop
    // forever (F-05), and the fstat check rejects directories, devices and
    // oversized files before a single byte is read.
    const fd = fs.openSync(
      statsPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 4096) return { memoryKb: 0, cpuMs: 0 };
      const buffer = Buffer.alloc(128);
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const fields = buffer.subarray(0, length).toString('utf8').trim().split(/\s+/);
      return {
        memoryKb: Number.isFinite(Number(fields[0])) ? Number(fields[0]) : 0,
        cpuMs: Number.isFinite(Number(fields[1])) ? Math.round(Number(fields[1]) * 1000) : 0,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { memoryKb: 0, cpuMs: 0 };
  } finally {
    safeUnlink(statsPath);
  }
}

export const timeWrapper = '/usr/bin/time';

/** Run the payload under dumb-init so PID 1 forwards signals to its child. */
export function withInit(argv: string[]): string[] {
  return config.tools.dumbInit ? [config.tools.dumbInit, '--', ...argv] : argv;
}
export { DEV_NAMES };
