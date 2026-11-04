import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type {
  Capabilities,
  CompilerCapability,
  CompilerId,
  OptId,
  StdId,
} from '../shared/types.js';
import { config } from './config.js';
import { assertSandboxReady, createWorkdir, cleanupWorkdir, execLimits, runInSandbox } from './sandbox/nsjail.js';
import { checkDevices } from './sandbox/rootfs.js';

let cached: Capabilities | undefined;

function toolVersion(binary: string | undefined, args: string[]): string | undefined {
  if (!binary) return undefined;
  try {
    const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 2500 });
    const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    return text.split(/\r?\n/)[0]?.slice(0, 160) || undefined;
  } catch {
    return undefined;
  }
}

function compilerCapability(id: CompilerId, binary: string | undefined, label: string): CompilerCapability {
  return {
    id,
    label,
    available: Boolean(binary),
    version: toolVersion(binary, ['--version']),
  };
}

export async function detectCapabilities(): Promise<Capabilities> {
  if (cached) return cached;

  const sandboxError = await probeSandbox();
  const devices = checkDevices();
  const nsjailReady = Boolean(config.sandbox.nsjailPath);
  const compilerList: CompilerCapability[] = [
    compilerCapability('g++', config.tools.gxx, 'GCC g++'),
    compilerCapability('clang++', config.tools.clangxx, 'Clang++'),
  ];

  cached = {
    compilers: compilerList,
    stds: ['c++17', 'c++20', 'c++23'] as StdId[],
    opts: ['-O0', '-O1', '-O2', '-O3', '-Os'] as OptId[],
    sandbox: {
      driver: 'nsjail',
      available: nsjailReady && devices.ready && !sandboxError,
      detail: sandboxError ?? (devices.ready ? 'nsjail 就绪' : devices.detail),
      devicesReady: devices.ready,
      version: 'nsjail',
    },
    tools: {
      formatter: Boolean(config.tools.clangFormat),
      formatterVersion: toolVersion(config.tools.clangFormat, ['--version']),
      debugger: Boolean(config.tools.lldbDap),
      debuggerVersion: toolVersion(config.tools.lldbDap, ['--version']),
    },
    limits: {
      maxFiles: config.limits.maxFiles,
      maxSourceBytes: config.limits.maxSourceBytes,
      maxStdinBytes: config.limits.maxStdinBytes,
      maxOutputBytes: config.limits.maxOutputBytes,
      maxRunTimeMs: config.limits.maxRunTimeMs,
      maxMemoryMb: config.limits.maxMemoryMb,
      maxDebugSessions: config.limits.maxDebugSessions,
    },
  };
  return cached;
}

/** Smoke-test the jail once so the UI can distinguish "not set up" from a bad request. */
async function probeSandbox(): Promise<string | undefined> {
  if (!config.sandbox.nsjailPath) {
    return 'nsjail 未安装；请运行 npm run sandbox:setup';
  }
  if (!checkDevices().ready) return checkDevices().detail;
  let workdir: string | undefined;
  try {
    assertSandboxReady();
    workdir = createWorkdir();
    fs.writeFileSync(`${workdir}/probe.c`, 'int main(){return 0;}\n');
    const result = await runInSandbox({
      purpose: 'exec',
      workdir,
      argv: ['/usr/bin/true'],
      limits: execLimits(1000, 64),
      timeoutMs: 3000,
      outputLimitBytes: 4096,
    });
    if (result.spawnError) return result.spawnError;
    if (result.exitCode !== 0) {
      const snippet = result.nsjailLog.split(/\r?\n/).slice(-3).join(' ').slice(0, 300);
      return `nsjail 自检失败：${snippet || result.stderr.slice(0, 200) || '未知错误'}`;
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    if (workdir) cleanupWorkdir(workdir);
  }
}
