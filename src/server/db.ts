import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  AdminUser,
  AuthUser,
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
  UserRole,
  UserStatus,
} from '../shared/types.js';
import { config } from './config.js';
import { migrateLegacySeed } from './i18nMigration.js';

interface ProjectRow {
  id: string;
  owner: string | null;
  owner_id: string | null;
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

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  status: string;
  must_change_password: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  ip: string | null;
  user_agent: string | null;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  ip: string | null;
  userAgent: string | null;
}

const SCHEMA_VERSION = 1;

const DEFAULT_SOURCE = `#include <algorithm>
#include <iostream>
#include <vector>

using namespace std;

// __i18n__:db.sampleComment
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

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function userVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

/**
 * M5 policy: one account may have exactly one active device/session. Older
 * databases may already hold several; keep the newest and revoke the rest
 * before the unique partial index is created.
 */
function pruneDuplicateAuthSessions(database: DatabaseSync): number {
  const result = database
    .prepare(
      `UPDATE auth_sessions SET revoked_at = ?
       WHERE revoked_at IS NULL AND id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY user_id ORDER BY created_at DESC, id DESC
           ) AS rn
           FROM auth_sessions WHERE revoked_at IS NULL
         ) WHERE rn = 1
       )`,
    )
    .run(Date.now());
  return Number(result.changes);
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner TEXT,
      owner_id TEXT REFERENCES users(id),
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
    CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS debug_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pid INTEGER,
      started_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      ended_at INTEGER
    );
  `);

  // Databases created before M5 have projects without owner_id.
  if (!hasColumn(database, 'projects', 'owner_id')) {
    database.exec('ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id)');
  }
}

/**
 * Restrict data/ and the SQLite files now that they hold password hashes and
 * session tokens (AGENTS.md §7 / multi-user-auth.md §11.3).
 */
function tightenDataPermissions(): void {
  const paths: Array<[string, number]> = [
    [config.dataDir, 0o700],
    [config.dbPath, 0o600],
    [`${config.dbPath}-wal`, 0o600],
    [`${config.dbPath}-shm`, 0o600],
  ];
  for (const [target, mode] of paths) {
    try {
      if (fs.existsSync(target)) fs.chmodSync(target, mode);
    } catch {
      // Best effort: a read-only or unusual filesystem must not block startup.
    }
  }
}

export function initDb(): void {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true, mode: 0o700 });
  db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  const version = userVersion(db);
  if (version > SCHEMA_VERSION) {
    throw new Error(`database schema version ${version} is newer than this build supports (${SCHEMA_VERSION})`);
  }
  createSchema(db);
  migrateLegacySeed(db);
  pruneDuplicateAuthSessions(db);
  // Hard guarantee at the storage layer; the login transaction also revokes
  // the previous session before inserting the new one.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_single_active
       ON auth_sessions(user_id) WHERE revoked_at IS NULL`,
  );
  if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  tightenDataPermissions();
}

function requireDb(): DatabaseSync {
  if (!db) throw new Error('database has not been initialized');
  return db;
}

function transaction<T>(fn: (database: DatabaseSync) => T): T {
  const database = requireDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = fn(database);
    database.exec('COMMIT');
    return value;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
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

const PROJECT_COLUMNS =
  'id, owner, owner_id, name, entry, compiler, std, opt, created_at, updated_at';

export function getProject(projectId: string): Project | null {
  const row = requireDb()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`)
    .get(projectId) as ProjectRow | undefined;
  return row ? asProject(row) : null;
}

/** One personal project per user for now; the schema already allows more. */
export function getProjectForUser(userId: string): Project | null {
  const row = requireDb()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1`)
    .get(userId) as ProjectRow | undefined;
  return row ? asProject(row) : null;
}

export function createProjectForUser(userId: string, name = '__i18n__:db.projectName'): Project {
  const id = randomUUID();
  const now = Date.now();
  transaction((database) => {
    database
      .prepare(
        `INSERT INTO projects (id, owner, owner_id, name, entry, compiler, std, opt, created_at, updated_at)
         VALUES (?, NULL, ?, ?, 'main.cpp', 'g++', 'c++20', '-O0', ?, ?)`,
      )
      .run(id, userId, name, now, now);
    database
      .prepare('INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, 'main.cpp', DEFAULT_SOURCE, now);
  });
  const project = getProject(id);
  if (!project) throw new Error('failed to create project');
  return project;
}

/**
 * Legacy installs have projects with `owner_id IS NULL`. The first account ever
 * created adopts them, so an existing single-user workspace is not lost. Any
 * remaining orphans after that are a fail-closed condition checked at startup.
 */
export function claimOrphanProjects(userId: string): number {
  const result = requireDb().prepare('UPDATE projects SET owner_id = ? WHERE owner_id IS NULL').run(userId);
  return Number(result.changes);
}

export function countOrphanProjects(): number {
  const row = requireDb().prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id IS NULL').get() as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}

export function getFiles(projectId: string): FileEntry[] {
  const rows = requireDb()
    .prepare('SELECT path, content FROM files WHERE project_id = ? ORDER BY path')
    .all(projectId) as unknown as FileRow[];
  return rows.map((row) => ({ path: row.path, content: row.content }));
}

export function getFilesMap(projectId: string): Record<string, string> {
  const map: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const file of getFiles(projectId)) map[file.path] = file.content;
  return map;
}

export function updateProjectSettings(projectId: string, settings: Partial<ProjectSettings>, name?: string): Project {
  const current = getProject(projectId);
  if (!current) throw new Error('project not found');
  const next = { ...current.settings, ...settings };
  const displayName = name?.trim() || current.name;
  requireDb()
    .prepare('UPDATE projects SET entry = ?, compiler = ?, std = ?, opt = ?, name = ?, updated_at = ? WHERE id = ?')
    .run(next.entry, next.compiler, next.std, next.opt, displayName, Date.now(), projectId);
  return getProject(projectId)!;
}

export function upsertFile(projectId: string, filePath: string, content: string): void {
  const now = Date.now();
  transaction((database) => {
    database
      .prepare(
        `INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      )
      .run(projectId, filePath, content, now);
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId);
  });
}

export function replaceFiles(projectId: string, files: FileEntry[], settings?: Partial<ProjectSettings>): void {
  const now = Date.now();
  transaction((database) => {
    database.prepare('DELETE FROM files WHERE project_id = ?').run(projectId);
    const insert = database.prepare('INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)');
    for (const file of files) insert.run(projectId, file.path, file.content, now);
    if (settings) {
      const current = getProject(projectId);
      if (!current) throw new Error('project not found');
      const next = { ...current.settings, ...settings };
      database
        .prepare('UPDATE projects SET entry = ?, compiler = ?, std = ?, opt = ?, updated_at = ? WHERE id = ?')
        .run(next.entry, next.compiler, next.std, next.opt, now, projectId);
    } else {
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId);
    }
  });
}

export function deleteFile(projectId: string, filePath: string): void {
  requireDb().prepare('DELETE FROM files WHERE project_id = ? AND path = ?').run(projectId, filePath);
}

interface RecordRunInput {
  projectId: string;
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
      input.projectId,
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

export function listRuns(projectId: string, limit = 40): RunSummary[] {
  const rows = requireDb()
    .prepare(
      `SELECT id, status, created_at, time_ms, memory_kb, compiler, std, opt, entry, flags, source_json
       FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, Math.max(1, Math.min(100, limit))) as unknown as RunRow[];
  return rows.map(asRunSummary);
}

/** The projectId is part of the lookup, so one user cannot read another's run. */
export function getRun(projectId: string, id: string): RunDetail | null {
  const row = requireDb()
    .prepare('SELECT * FROM runs WHERE id = ? AND project_id = ?')
    .get(id, projectId) as RunRow | undefined;
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

export function createDebugSessionRow(projectId: string, id: string, pid: number | null): void {
  const now = Date.now();
  requireDb()
    .prepare(
      'INSERT INTO debug_sessions (id, project_id, pid, started_at, last_active, ended_at) VALUES (?, ?, ?, ?, ?, NULL)',
    )
    .run(id, projectId, pid, now, now);
}

export function touchDebugSession(id: string): void {
  requireDb().prepare('UPDATE debug_sessions SET last_active = ? WHERE id = ?').run(Date.now(), id);
}

export function endDebugSession(id: string): void {
  requireDb().prepare('UPDATE debug_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), id);
}

// ------------------------------------------------------------------ users

function asUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    mustChangePassword: Number(row.must_change_password) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

export function toAdminUser(user: UserRecord): AdminUser {
  return {
    ...toAuthUser(user),
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function countUsers(): number {
  const row = requireDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

export function countAdmins(): number {
  const row = requireDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'")
    .get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

export function getUserById(id: string): UserRecord | null {
  const row = requireDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? asUserRecord(row) : null;
}

export function getUserByUsername(username: string): UserRecord | null {
  const row = requireDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  return row ? asUserRecord(row) : null;
}

export function listUsers(): UserRecord[] {
  const rows = requireDb().prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE ASC').all() as unknown as UserRow[];
  return rows.map(asUserRecord);
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword?: boolean;
}

/**
 * Creates the account and, when it is the very first one, adopts any legacy
 * project; otherwise it provisions a fresh personal project.
 */
export function createUser(input: CreateUserInput): { user: UserRecord; projectId: string; adopted: number } {
  const now = Date.now();
  const id = randomUUID();
  return transaction((database) => {
    const first = countUsers() === 0;
    database
      .prepare(
        `INSERT INTO users (id, username, display_name, password_hash, role, status, must_change_password, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.username,
        input.displayName,
        input.passwordHash,
        input.role,
        input.mustChangePassword ? 1 : 0,
        now,
        now,
      );
    let adopted = 0;
    if (first) adopted = claimOrphanProjects(id);
    let projectId: string;
    if (adopted === 0) {
      projectId = randomUUID();
      database
        .prepare(
          `INSERT INTO projects (id, owner, owner_id, name, entry, compiler, std, opt, created_at, updated_at)
           VALUES (?, NULL, ?, '__i18n__:db.projectName', 'main.cpp', 'g++', 'c++20', '-O0', ?, ?)`,
        )
        .run(projectId, id, now, now);
      database
        .prepare('INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)')
        .run(projectId, 'main.cpp', DEFAULT_SOURCE, now);
    } else {
      const row = database
        .prepare('SELECT id FROM projects WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1')
        .get(id) as { id: string } | undefined;
      projectId = row?.id ?? '';
    }
    const user = getUserById(id);
    if (!user) throw new Error('failed to create user');
    return { user, projectId, adopted };
  });
}

export function updateUserPassword(id: string, passwordHash: string, mustChangePassword: boolean): void {
  requireDb()
    .prepare('UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, mustChangePassword ? 1 : 0, Date.now(), id);
}

export function markUserLogin(id: string): void {
  const now = Date.now();
  requireDb().prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
}

export function setUserStatus(id: string, status: UserStatus): void {
  requireDb().prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
}

export function setUserRole(id: string, role: UserRole): void {
  requireDb().prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, Date.now(), id);
}

// --------------------------------------------------------------- sessions

function asAuthSession(row: AuthSessionRow): AuthSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

export interface CreateAuthSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ReplaceAuthSessionResult {
  session: AuthSessionRecord;
  /** Number of previous sessions revoked by this login. */
  revoked: number;
}

/**
 * Issue a new session and revoke every existing session for the account in the
 * same write transaction. This is the single-device policy: concurrent logins
 * serialize on `BEGIN IMMEDIATE`, so the last successful login wins.
 */
export function replaceAuthSession(input: CreateAuthSessionInput): ReplaceAuthSessionResult {
  const id = randomUUID();
  const now = Date.now();
  return transaction((database) => {
    const revoked = database
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(now, input.userId);
    database
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, input.userId, input.tokenHash, now, now, input.expiresAt, input.ip ?? null, input.userAgent ?? null);
    const row = database.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(id) as AuthSessionRow | undefined;
    if (!row) throw new Error('failed to create session');
    return { session: asAuthSession(row), revoked: Number(revoked.changes) };
  });
}

export function findAuthSessionByTokenHash(tokenHash: string): { session: AuthSessionRecord; user: UserRecord } | null {
  const row = requireDb().prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').get(tokenHash) as
    | AuthSessionRow
    | undefined;
  if (!row) return null;
  const user = getUserById(row.user_id);
  if (!user) return null;
  return { session: asAuthSession(row), user };
}

export function touchAuthSession(id: string): void {
  requireDb().prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(Date.now(), id);
}

export function revokeAuthSession(id: string): void {
  requireDb().prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), id);
}

/** Revoke every session of a user, optionally keeping the current one alive. */
export function revokeUserAuthSessions(userId: string, exceptSessionId?: string): number {
  const result = exceptSessionId
    ? requireDb()
        .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?')
        .run(Date.now(), userId, exceptSessionId)
    : requireDb()
        .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(Date.now(), userId);
  return Number(result.changes);
}

export function cleanupAuthSessions(now = Date.now(), revokedRetentionMs = 7 * 24 * 60 * 60 * 1000): number {
  const result = requireDb()
    .prepare('DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
    .run(now, now - revokedRetentionMs);
  return Number(result.changes);
}

export function newId(): string {
  return randomUUID();
}
