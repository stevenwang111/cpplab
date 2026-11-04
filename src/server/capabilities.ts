import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type {
  Capabilities,
  CompilerCapability,
  CompilerId,
  OptId,
  SandboxCapability,
  StdId,
} from '../shared/types.js';
import {
  localized,
  renderText,
  type Locale,
  type LocalizedText,
} from '../shared/i18n/index.js';
import { ApiError } from './util/errors.js';
import { config } from './config.js';
import { assertSandboxReady, createWorkdir, cleanupWorkdir, execLimits, runInSandbox } from './sandbox/nsjail.js';
import { checkDevices } from './sandbox/rootfs.js';

type RawSandboxCapability = Omit<SandboxCapability, 'detail'> & { detail: LocalizedText };

/** Detection runs once at boot, before any language is known, so it stores keys. */
export interface RawCapabilities extends Omit<Capabilities, 'sandbox'> {
  sandbox: RawSandboxCapability;
}

let cached: RawCapabilities | undefined;

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

export async function detectCapabilities(): Promise<RawCapabilities> {
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
      detail: sandboxError ?? (devices.ready ? localized('caps.nsjailReady') : devices.detail),
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

/** Render the boot-time detection result for one caller. */
export function localizeCapabilities(raw: RawCapabilities, locale: Locale): Capabilities {
  return {
    ...raw,
    sandbox: { ...raw.sandbox, detail: renderText(raw.sandbox.detail, locale) },
  };
}

/** Smoke-test the jail once so the UI can distinguish "not set up" from a bad request. */
async function probeSandbox(): Promise<LocalizedText | undefined> {
  if (!config.sandbox.nsjailPath) {
    return localized('caps.nsjailNotInstalled');
  }
  const devices = checkDevices();
  if (!devices.ready) return devices.detail;
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
    if (result.spawnError) return { text: result.spawnError };
    if (result.exitCode !== 0) {
      const snippet = result.nsjailLog.split(/\r?\n/).slice(-3).join(' ').slice(0, 300);
      const fallback = result.stderr.slice(0, 200);
      if (snippet || fallback) return localized('caps.nsjailProbeFailed', { snippet: snippet || fallback });
      return localized('caps.nsjailProbeFailedEmpty');
    }
    return undefined;
  } catch (error) {
    if (error instanceof ApiError) return error.text;
    return { text: error instanceof Error ? error.message : String(error) };
  } finally {
    if (workdir) cleanupWorkdir(workdir);
  }
}
