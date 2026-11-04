import type { CompilerId, OptId, StdId } from '../../shared/types.js';
import { ApiError } from '../util/errors.js';

const MAX_EXTRA_FLAGS = 12;
const MAX_FLAG_LENGTH = 160;
const MAX_FLAGS_BYTES = 800;

const EXACT_FLAGS = new Set([
  '-g',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-pthread',
  '-lm',
  '-fsanitize=address',
  '-fsanitize=undefined',
  '-fsanitize=address,undefined',
]);

/**
 * Compiler argv is an execution surface, not a string to be forwarded. Every
 * element is either generated here or matched against a narrow allowlist.
 */
export function sanitizeExtraFlags(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, 'INVALID_FLAGS', 'extraFlags 必须是字符串数组');
  }
  if (raw.length > MAX_EXTRA_FLAGS) {
    throw new ApiError(400, 'INVALID_FLAGS', `编译参数最多 ${MAX_EXTRA_FLAGS} 个`);
  }

  const result: string[] = [];
  let total = 0;

  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new ApiError(400, 'INVALID_FLAGS', '编译参数必须是字符串');
    }
    const flag = item.trim();
    if (!flag || flag.length > MAX_FLAG_LENGTH) {
      throw new ApiError(400, 'INVALID_FLAGS', '编译参数长度不合法');
    }
    if (/[\0\r\n]/.test(flag)) {
      throw new ApiError(400, 'INVALID_FLAGS', '编译参数包含非法字符');
    }
    total += Buffer.byteLength(flag);
    if (total > MAX_FLAGS_BYTES) {
      throw new ApiError(400, 'INVALID_FLAGS', '编译参数总长度超限');
    }

    if (EXACT_FLAGS.has(flag)) {
      result.push(flag);
      continue;
    }

    if (flag.startsWith('-D')) {
      result.push(validateDefine(flag));
      continue;
    }

    if (flag.startsWith('-I')) {
      result.push(validateIncludePath(flag.slice(2)));
      continue;
    }

    throw new ApiError(400, 'FLAG_NOT_ALLOWED', `不允许的编译参数：${flag}`);
  }

  return result;
}

function validateDefine(flag: string): string {
  const body = flag.slice(2);
  // Macro values may contain punctuation but never command substitution or
  // shell metacharacters that could be mistaken for adapter syntax later.
  const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.+))?$/.exec(body);
  if (!match) {
    throw new ApiError(400, 'FLAG_NOT_ALLOWED', `不允许的宏定义：${flag}`);
  }
  const value = match[2];
  if (value !== undefined) {
    if (!/^[A-Za-z0-9_.,:+\-*/%<>=!&|^~"'()\[\] ]+$/.test(value)) {
      throw new ApiError(400, 'FLAG_NOT_ALLOWED', `宏定义值包含非法字符：${flag}`);
    }
  }
  return flag;
}

function validateIncludePath(raw: string): string {
  if (!raw || raw.startsWith('/') || raw.includes('..') || raw.includes('\\')) {
    throw new ApiError(400, 'FLAG_NOT_ALLOWED', `头文件目录必须位于工作区内：-I${raw}`);
  }
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  const normalized = parts.join('/');
  if (!normalized) return '-I/workspace';
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(normalized)) {
    throw new ApiError(400, 'FLAG_NOT_ALLOWED', `头文件目录名不合法：-I${raw}`);
  }
  return `-I/workspace/${normalized}`;
}

export interface CompileArgOptions {
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  debug: boolean;
  extraFlags: string[];
  sourcePath: string;
  outputPath: string;
}

export function buildCompileArgs(options: CompileArgOptions): string[] {
  const flags = [
    `-std=${options.std}`,
    '-fdiagnostics-color=never',
    '-fmessage-length=0',
    '-fmax-errors=50',
  ];

  if (options.debug) {
    // Optimized builds discard variables and line information; debugging must
    // always use -O0 regardless of the editor selection.
    flags.push('-g', '-O0');
  } else {
    flags.push(options.opt);
  }

  flags.push(...options.extraFlags, options.sourcePath, '-o', options.outputPath);
  return flags;
}

export function compilerExecutable(compiler: CompilerId, gxx?: string, clangxx?: string): string {
  if (compiler === 'clang++') {
    if (!clangxx) throw new ApiError(400, 'COMPILER_UNAVAILABLE', 'clang++ 未安装');
    return clangxx;
  }
  if (!gxx) throw new ApiError(400, 'COMPILER_UNAVAILABLE', 'g++ 未安装');
  return gxx;
}
