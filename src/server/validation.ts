import path from 'node:path';
import {
  COMPILERS,
  MAX_FILES,
  MAX_MEMORY_MB,
  MAX_OUTPUT_BYTES,
  MAX_RUN_TIME_MS,
  MAX_SOURCE_BYTES,
  MAX_STDIN_BYTES,
  OPTS,
  STDS,
  type CompilerId,
  type DebugStartRequest,
  type FileEntry,
  type Limits,
  type OptId,
  type RunRequest,
  type StdId,
} from '../shared/types.js';
import { ApiError } from './util/errors.js';
import { sanitizeExtraFlags } from './compile/flags.js';
import { config } from './config.js';

const PATH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/;

export function normalizeFilePath(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'INVALID_PATH', '文件路径必须是字符串');
  }
  const value = raw.trim();
  if (!value || value.length > 160) {
    throw new ApiError(400, 'INVALID_PATH', '文件路径长度不合法');
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    throw new ApiError(400, 'INVALID_PATH', `非法文件路径：${value}`);
  }
  if (!PATH_PATTERN.test(value)) {
    throw new ApiError(400, 'INVALID_PATH', `文件路径只能包含字母、数字、下划线、点和斜杠：${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/') ||
    normalized.split('/').some((part) => part === '' || part === '.' || part === '..' || part.length > 80)
  ) {
    throw new ApiError(400, 'INVALID_PATH', `非法文件路径：${value}`);
  }
  return normalized;
}

export interface ValidatedFiles {
  files: FileEntry[];
  map: Record<string, string>;
  entry: string;
  sourceBytes: number;
}

export function validateFiles(filesInput: unknown, entryInput: unknown): ValidatedFiles {
  if (!filesInput || typeof filesInput !== 'object' || Array.isArray(filesInput)) {
    throw new ApiError(400, 'INVALID_FILES', 'files 必须是对象');
  }
  const entries = Object.entries(filesInput as Record<string, unknown>);
  if (entries.length === 0) {
    throw new ApiError(400, 'INVALID_FILES', '至少需要一个源文件');
  }
  if (entries.length > MAX_FILES) {
    throw new ApiError(400, 'TOO_MANY_FILES', `文件数量不能超过 ${MAX_FILES} 个`);
  }

  const map: Record<string, string> = Object.create(null) as Record<string, string>;
  const files: FileEntry[] = [];
  let sourceBytes = 0;

  for (const [rawPath, content] of entries) {
    const filePath = normalizeFilePath(rawPath);
    if (typeof content !== 'string') {
      throw new ApiError(400, 'INVALID_FILES', `文件内容必须是字符串：${filePath}`);
    }
    if (map[filePath] !== undefined) {
      throw new ApiError(400, 'INVALID_FILES', `文件路径重复：${filePath}`);
    }
    const bytes = Buffer.byteLength(content);
    sourceBytes += bytes;
    if (bytes > MAX_SOURCE_BYTES) {
      throw new ApiError(400, 'SOURCE_TOO_LARGE', `单个文件不能超过 ${MAX_SOURCE_BYTES / 1024} KiB`);
    }
    if (sourceBytes > MAX_SOURCE_BYTES) {
      throw new ApiError(400, 'SOURCE_TOO_LARGE', `源码总大小不能超过 ${MAX_SOURCE_BYTES / 1024} KiB`);
    }
    map[filePath] = content;
    files.push({ path: filePath, content });
  }

  const entry = normalizeFilePath(entryInput);
  if (map[entry] === undefined) {
    throw new ApiError(400, 'ENTRY_MISSING', `入口文件不存在：${entry}`);
  }

  return { files, map, entry, sourceBytes };
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ApiError(400, 'INVALID_REQUEST', `${field} 取值不合法`);
  }
  return value as T;
}

export function normalizeLimits(input: unknown): Limits {
  const raw = (input ?? {}) as Partial<Limits>;
  const timeMs = clampNumber(raw.timeMs, config.limits.minRunTimeMs, MAX_RUN_TIME_MS, config.limits.defaultRunTimeMs);
  const memoryMb = clampNumber(raw.memoryMb, config.limits.minMemoryMb, MAX_MEMORY_MB, config.limits.defaultMemoryMb);
  const outputBytes = clampNumber(raw.outputBytes, 1024, MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
  return { timeMs, memoryMb, outputBytes };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export interface ValidatedRun {
  files: ValidatedFiles;
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  extraFlags: string[];
  stdin: string;
  limits: Limits;
}

export function validateRunRequest(body: unknown): ValidatedRun {
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'INVALID_REQUEST', '请求体必须是 JSON 对象');
  }
  const input = body as Partial<RunRequest>;
  const files = validateFiles(input.files, input.entry);
  const compiler = enumValue(input.compiler, COMPILERS, 'compiler', 'g++');
  const std = enumValue(input.std, STDS, 'std', 'c++20');
  const opt = enumValue(input.opt, OPTS, 'opt', '-O0');
  const extraFlags = sanitizeExtraFlags(input.extraFlags);
  const stdin = typeof input.stdin === 'string' ? input.stdin : '';
  if (Buffer.byteLength(stdin) > MAX_STDIN_BYTES) {
    throw new ApiError(413, 'STDIN_TOO_LARGE', `标准输入不能超过 ${MAX_STDIN_BYTES / 1024} KiB`);
  }
  return { files, compiler, std, opt, extraFlags, stdin, limits: normalizeLimits(input.limits) };
}

export interface ValidatedDebugStart {
  files: ValidatedFiles;
  compiler: CompilerId;
  std: StdId;
  extraFlags: string[];
}

export function validateDebugStart(body: unknown): ValidatedDebugStart {
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'INVALID_REQUEST', '请求体必须是 JSON 对象');
  }
  const input = body as Partial<DebugStartRequest>;
  const files = validateFiles(input.files, input.entry);
  const compiler = enumValue(input.compiler, COMPILERS, 'compiler', 'g++');
  const std = enumValue(input.std, STDS, 'std', 'c++20');
  return { files, compiler, std, extraFlags: sanitizeExtraFlags(input.extraFlags) };
}

export function validateFormatRequest(body: unknown): { file: string; content: string } {
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'INVALID_REQUEST', '请求体必须是 JSON 对象');
  }
  const input = body as { file?: unknown; content?: unknown };
  const file = normalizeFilePath(input.file);
  if (typeof input.content !== 'string') {
    throw new ApiError(400, 'INVALID_REQUEST', 'content 必须是字符串');
  }
  if (Buffer.byteLength(input.content) > MAX_SOURCE_BYTES) {
    throw new ApiError(413, 'SOURCE_TOO_LARGE', '源码过大');
  }
  return { file, content: input.content };
}
