/**
 * Contract shared by the local workspace store, the WebAssembly toolchain and
 * the React client.
 *
 * There is no HTTP API any more: every type below describes data that is
 * produced inside the browser. The shapes are kept close to the previous
 * server contract so the run history and settings migration stay simple.
 */

/** The browser toolchain ships a single C++ compiler (LLVM/clang). */
export const COMPILERS = ['clang++'] as const;
export type CompilerId = (typeof COMPILERS)[number];

export const STDS = ['c++17', 'c++20', 'c++23'] as const;
export type StdId = (typeof STDS)[number];

export const OPTS = ['-O0', '-O1', '-O2', '-O3', '-Os'] as const;
export type OptId = (typeof OPTS)[number];

export const RUN_STATUSES = ['OK', 'CE', 'RE', 'TLE', 'MLE', 'OLE', 'IE'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const MAX_FILES = 16;
export const MAX_SOURCE_BYTES = 256 * 1024;
export const MAX_STDIN_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_RUN_TIME_MS = 10_000;
export const MAX_MEMORY_MB = 512;

export interface Limits {
  timeMs: number;
  memoryMb: number;
  outputBytes: number;
}

export interface FileEntry {
  path: string;
  content: string;
}

export interface ProjectSettings {
  entry: string;
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
}

export interface Project {
  id: string;
  name: string;
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectState {
  project: Project;
  files: FileEntry[];
  capabilities: Capabilities;
}

export interface CompilerCapability {
  id: CompilerId;
  label: string;
  available: boolean;
  version?: string;
}

/**
 * State of the in-browser toolchain. `crossOriginIsolated` reports whether
 * COOP/COEP are in effect, which lets the compiler worker use
 * SharedArrayBuffer; the toolchain still boots without it, just slower.
 */
export interface ToolchainCapability {
  driver: 'wasm';
  available: boolean;
  detail: string;
  runtime: 'wasm32-wasi';
  crossOriginIsolated: boolean;
  llvmVersion: string;
}

export interface ToolCapabilities {
  formatter: boolean;
  formatterVersion?: string;
  /** Source-level debugging is not possible in a pure client build. */
  debugger: false;
}

export interface CapabilityLimits {
  maxFiles: number;
  maxSourceBytes: number;
  maxStdinBytes: number;
  maxOutputBytes: number;
  maxRunTimeMs: number;
  maxMemoryMb: number;
}

export interface Capabilities {
  compilers: CompilerCapability[];
  stds: StdId[];
  opts: OptId[];
  toolchain: ToolchainCapability;
  tools: ToolCapabilities;
  limits: CapabilityLimits;
}

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export interface RunRequest {
  files: Record<string, string>;
  entry: string;
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  extraFlags?: string[];
  stdin?: string;
  limits?: Partial<Limits>;
}

export interface RunSourceMeta {
  entry: string;
  compiler: CompilerId;
  std: StdId;
  opt: OptId;
  extraFlags: string[];
}

export interface RunResult {
  id: string;
  status: RunStatus;
  exitCode: number | null;
  signal: number | null;
  stdout: string;
  stderr: string;
  compileOutput: string;
  diagnostics: Diagnostic[];
  timeMs: number;
  compileTimeMs: number;
  memoryKb: number;
  createdAt: number;
  source: RunSourceMeta;
}

export type RunPhase = 'queued' | 'compiling' | 'running' | 'finished';

/**
 * Progress stream for a run. The client-side runner emits the same shape the
 * old WebSocket bridge used, so the UI logic barely changed.
 */
export type RunEvent =
  | { type: 'phase'; phase: RunPhase; message?: string }
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string };

export interface RunSummary {
  id: string;
  status: RunStatus;
  createdAt: number;
  timeMs: number;
  memoryKb: number;
  source: RunSourceMeta;
  sourceBytes: number;
}

export interface RunDetail extends RunResult {
  files: Record<string, string>;
  stdin: string;
}

export interface WorkspaceError {
  code: string;
  message: string;
  detail?: string;
}
