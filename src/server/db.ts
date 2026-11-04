import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  CompilerId,
  FileEntry,
  OptId,
  Project,
  ProjectSettings,
  RunDetail,
  RunResult,
  RunStatus,
  RunSummary,
  StdId,
} from '../shared/types.js';
import { config } from './config.js';

interface ProjectRow {
  id: string;
  owner: string | null;
  name: string;
  entry: string;
  compiler: string;
  std: string;
  opt: string;
  created_at: number;
  updated_at: number;
}

interface FileRow {
  path: string;
  content: string;
}

interface RunRow {
  id: string;
  project_id: string;
  kind: string;
  compiler: string;
  std: string;
  opt: string;
  flags: string | null;
  status: string;
  exit_code: number | null;
  signal: number | null;
  time_ms: number;
  memory_kb: number;
  stdout: string;
  stderr: string;
  compile_output: string;
  diagnostics: string;
  source_json: string;
  stdin: string;
  entry: string;
  created_at: number;
}

const DEFAULT_PROJECT_ID = 'playground';

const DEFAULT_SOURCE = `#include <algorithm>
#include <iostream>
#include <vector>

using namespace std;

// 在 main 中设置断点，观察 values 的变化。
int main() {
    const int n = 8;
    vector<int> values(n);
    for (int i = 0; i < n; ++i) {
        values[i] = (i * 7 + 3) % 100;
    }

    sort(values.begin(), values.end());
    cout << "sorted:";
    for (int value : values) {
        cout << ' ' << value;
    }
    cout << endl;
    return 0;
}
`;

let db: DatabaseSync | undefined;

export function initDb(): void {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner TEXT,
      name TEXT NOT NULL,
      entry TEXT NOT NULL DEFAULT 'main.cpp',
      compiler TEXT NOT NULL DEFAULT 'g++',
      std TEXT NOT NULL DEFAULT 'c++20',
      opt TEXT NOT NULL DEFAULT '-O0',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, path),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      compiler TEXT NOT NULL,
      std TEXT NOT NULL,
      opt TEXT NOT NULL,
      flags TEXT,
      status TEXT NOT NULL,
      exit_code INTEGER,
      signal INTEGER,
      time_ms INTEGER NOT NULL DEFAULT 0,
      memory_kb INTEGER NOT NULL DEFAULT 0,
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      compile_output TEXT NOT NULL DEFAULT '',
      diagnostics TEXT NOT NULL DEFAULT '[]',
      source_json TEXT NOT NULL DEFAULT '{}',
      stdin TEXT NOT NULL DEFAULT '',
      entry TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS runs_created_at ON runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS debug_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pid INTEGER,
      started_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      ended_at INTEGER
    );
  `);

  const now = Date.now();
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(DEFAULT_PROJECT_ID) as
    | { id: string }
    | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO projects (id, owner, name, entry, compiler, std, opt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(DEFAULT_PROJECT_ID, null, '我的 C++ 项目', 'main.cpp', 'g++', 'c++20', '-O0', now, now);
    db.prepare('INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)').run(
      DEFAULT_PROJECT_ID,
      'main.cpp',
      DEFAULT_SOURCE,
      now,
    );
  }
}

function requireDb(): DatabaseSync {
  if (!db) throw new Error('database has not been initialized');
  return db;
}

function asProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    settings: {
      entry: row.entry,
      compiler: row.compiler as CompilerId,
      std: row.std as StdId,
      opt: row.opt as OptId,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProject(): Project {
  const row = requireDb()
    .prepare('SELECT id, owner, name, entry, compiler, std, opt, created_at, updated_at FROM projects WHERE id = ?')
    .get(DEFAULT_PROJECT_ID) as ProjectRow | undefined;
  if (!row) throw new Error('default project missing');
  return asProject(row);
}

export function getFiles(): FileEntry[] {
  const rows = requireDb()
    .prepare('SELECT path, content FROM files WHERE project_id = ? ORDER BY path')
    .all(DEFAULT_PROJECT_ID) as unknown as FileRow[];
  return rows.map((row) => ({ path: row.path, content: row.content }));
}

export function getFilesMap(): Record<string, string> {
  const map: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const file of getFiles()) map[file.path] = file.content;
  return map;
}

export function updateProjectSettings(settings: Partial<ProjectSettings>, name?: string): Project {
  const current = getProject();
  const next = { ...current.settings, ...settings };
  const displayName = name?.trim() || current.name;
  requireDb()
    .prepare('UPDATE projects SET entry = ?, compiler = ?, std = ?, opt = ?, name = ?, updated_at = ? WHERE id = ?')
    .run(next.entry, next.compiler, next.std, next.opt, displayName, Date.now(), DEFAULT_PROJECT_ID);
  return getProject();
}

export function upsertFile(filePath: string, content: string): void {
  requireDb()
    .prepare(
      `INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    )
    .run(DEFAULT_PROJECT_ID, filePath, content, Date.now());
  requireDb().prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), DEFAULT_PROJECT_ID);
}

export function replaceFiles(files: FileEntry[], settings?: Partial<ProjectSettings>): void {
  const database = requireDb();
  const now = Date.now();
  database.exec('BEGIN');
  try {
    database.prepare('DELETE FROM files WHERE project_id = ?').run(DEFAULT_PROJECT_ID);
    const insert = database.prepare('INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)');
    for (const file of files) insert.run(DEFAULT_PROJECT_ID, file.path, file.content, now);
    if (settings) {
      const current = getProject();
      const next = { ...current.settings, ...settings };
      database
        .prepare('UPDATE projects SET entry = ?, compiler = ?, std = ?, opt = ?, updated_at = ? WHERE id = ?')
        .run(next.entry, next.compiler, next.std, next.opt, now, DEFAULT_PROJECT_ID);
    } else {
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, DEFAULT_PROJECT_ID);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function deleteFile(filePath: string): void {
  requireDb()
    .prepare('DELETE FROM files WHERE project_id = ? AND path = ?')
    .run(DEFAULT_PROJECT_ID, filePath);
}

interface RecordRunInput {
  kind: 'run' | 'debug';
  result: RunResult;
  files: Record<string, string>;
  stdin: string;
}

export function recordRun(input: RecordRunInput): void {
  const { result } = input;
  requireDb()
    .prepare(
      `INSERT INTO runs (
        id, project_id, kind, compiler, std, opt, flags, status, exit_code, signal,
        time_ms, memory_kb, stdout, stderr, compile_output, diagnostics, source_json, stdin, entry, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      result.id,
      DEFAULT_PROJECT_ID,
      input.kind,
      result.source.compiler,
      result.source.std,
      result.source.opt,
      JSON.stringify(result.source.extraFlags),
      result.status,
      result.exitCode,
      result.signal,
      result.timeMs,
      result.memoryKb,
      result.stdout.slice(0, config.limits.maxOutputBytes),
      result.stderr.slice(0, config.limits.maxOutputBytes),
      result.compileOutput.slice(0, config.limits.maxCompileOutputBytes),
      JSON.stringify(result.diagnostics),
      JSON.stringify(input.files),
      input.stdin.slice(0, config.limits.maxStdinBytes),
      result.source.entry,
      result.createdAt,
    );
}

function asRunSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    status: row.status as RunStatus,
    createdAt: row.created_at,
    timeMs: row.time_ms,
    memoryKb: row.memory_kb,
    source: {
      entry: row.entry,
      compiler: row.compiler as CompilerId,
      std: row.std as StdId,
      opt: row.opt as OptId,
      extraFlags: parseFlags(row.flags),
    },
    sourceBytes: Buffer.byteLength(row.source_json),
  };
}

function parseFlags(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function listRuns(limit = 40): RunSummary[] {
  const rows = requireDb()
    .prepare(
      `SELECT id, status, created_at, time_ms, memory_kb, compiler, std, opt, entry, flags, source_json
       FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(DEFAULT_PROJECT_ID, Math.max(1, Math.min(100, limit))) as unknown as RunRow[];
  return rows.map(asRunSummary);
}

export function getRun(id: string): RunDetail | null {
  const row = requireDb().prepare('SELECT * FROM runs WHERE id = ? AND project_id = ?').get(id, DEFAULT_PROJECT_ID) as
    | RunRow
    | undefined;
  if (!row) return null;
  const diagnostics = safeJson(row.diagnostics, []);
  const files = safeJson(row.source_json, {});
  return {
    id: row.id,
    status: row.status as RunStatus,
    exitCode: row.exit_code,
    signal: row.signal,
    stdout: row.stdout,
    stderr: row.stderr,
    compileOutput: row.compile_output,
    diagnostics,
    timeMs: row.time_ms,
    compileTimeMs: 0,
    memoryKb: row.memory_kb,
    createdAt: row.created_at,
    source: {
      entry: row.entry,
      compiler: row.compiler as CompilerId,
      std: row.std as StdId,
      opt: row.opt as OptId,
      extraFlags: parseFlags(row.flags),
    },
    files,
    stdin: row.stdin,
  };
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createDebugSessionRow(id: string, pid: number | null): void {
  const now = Date.now();
  requireDb()
    .prepare(
      'INSERT INTO debug_sessions (id, project_id, pid, started_at, last_active, ended_at) VALUES (?, ?, ?, ?, ?, NULL)',
    )
    .run(id, DEFAULT_PROJECT_ID, pid, now, now);
}

export function touchDebugSession(id: string): void {
  requireDb().prepare('UPDATE debug_sessions SET last_active = ? WHERE id = ?').run(Date.now(), id);
}

export function endDebugSession(id: string): void {
  requireDb().prepare('UPDATE debug_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), id);
}

export function newId(): string {
  return randomUUID();
}
