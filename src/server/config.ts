import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = process.cwd();

function firstExecutable(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next location.
    }
  }
  return undefined;
}

function findOnPath(names: string[]): string | undefined {
  const dirs = (process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin').split(path.delimiter);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue searching.
      }
    }
  }
  return undefined;
}

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  projectRoot: root,
  dataDir: path.join(root, 'data'),
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'cpplab.db'),
  clientDir: path.join(root, 'dist', 'client'),
  sandbox: {
    nsjailPath:
      firstExecutable([process.env.NSJAIL_PATH, '/usr/local/bin/nsjail', '/usr/bin/nsjail']) ??
      findOnPath(['nsjail']),
    // Host uid/gid the jailed process really runs as (F-01). Must never be the
    // service user: the sandbox is not allowed to own or mutate host files.
    uid: Number(process.env.SANDBOX_UID ?? 10000),
    gid: Number(process.env.SANDBOX_GID ?? 10000),
    rootfsDir: path.join(root, 'data', 'sandbox', 'rootfs'),
    devDir: path.join(root, 'data', 'sandbox', 'dev'),
    configDir: path.join(root, 'src', 'server', 'sandbox', 'config'),
    runtimeDir: path.join(root, 'data', 'runtime'),
    logDir: path.join(root, 'data', 'runtime', 'logs'),
  },
  tools: {
    clangFormat:
      firstExecutable([process.env.CLANG_FORMAT_PATH, '/usr/bin/clang-format']) ??
      findOnPath(['clang-format', 'clang-format-21', 'clang-format-20']),
    dumbInit: firstExecutable([process.env.DUMB_INIT_PATH, '/usr/bin/dumb-init']) ?? findOnPath(['dumb-init']),
    lldbDap:
      firstExecutable([process.env.LLDB_DAP_PATH, '/usr/bin/lldb-dap', '/usr/lib/llvm-21/bin/lldb-dap']) ??
      findOnPath(['lldb-dap', 'lldb-dap-21', 'lldb-dap-20']),
    clangxx:
      firstExecutable([process.env.CLANGXX_PATH, '/usr/bin/clang++']) ??
      findOnPath(['clang++', 'clang++-21', 'clang++-20']),
    gxx: firstExecutable(['/usr/bin/g++']) ?? findOnPath(['g++']),
  },
  limits: {
    maxFiles: 16,
    maxSourceBytes: 256 * 1024,
    maxStdinBytes: 1024 * 1024,
    maxOutputBytes: 64 * 1024,
    maxCompileOutputBytes: 512 * 1024,
    maxRunTimeMs: 10_000,
    defaultRunTimeMs: 2_000,
    minRunTimeMs: 200,
    maxMemoryMb: 512,
    defaultMemoryMb: 256,
    minMemoryMb: 64,
    compileTimeMs: 20_000,
    compileMemoryMb: 1024,
    maxDebugSessions: 2,
    debugIdleTimeoutMs: 5 * 60 * 1000,
    debugHardTimeoutMs: 30 * 60 * 1000,
    maxConcurrentCompiles: 2,
    maxConcurrentRuns: 4,
    rateLimitPerSecond: 1,
    rateLimitBurst: 5,
  },
  debug: {
    memoryMb: 1024,
    pidsMax: 256,
    timeLimitSec: 3600,
    sandboxCwd: '/workspace',
    programPath: '/workspace/prog',
  },
  workRoot: process.env.WORK_ROOT ?? path.join(os.tmpdir(), 'cpplab-work'),
  maxBodyBytes: 3 * 1024 * 1024,
} as const;

export type AppConfig = typeof config;
