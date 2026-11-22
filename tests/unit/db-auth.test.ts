import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplab-auth-test-'));
const dbPath = path.join(tempDir, 'legacy.db');
process.env.DB_PATH = dbPath;

// Build a legacy database: one project and one file, no users, version 0.
const legacy = new DatabaseSync(dbPath);
legacy.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE projects (
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
  CREATE TABLE files (
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, path)
  );
  CREATE TABLE runs (
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
  CREATE TABLE debug_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    pid INTEGER,
    started_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL,
    ended_at INTEGER
  );
  INSERT INTO projects (id, owner, name, entry, compiler, std, opt, created_at, updated_at)
    VALUES ('playground', NULL, 'legacy project', 'main.cpp', 'g++', 'c++20', '-O0', 1, 1);
  INSERT INTO files (project_id, path, content, updated_at)
    VALUES ('playground', 'main.cpp', 'int main(){return 0;}', 1);
`);
legacy.close();

const db = await import('../../src/server/db.js');

test('migration adds users, sessions and owner_id without touching legacy rows', () => {
  db.initDb();
  const check = new DatabaseSync(dbPath);
  const version = (check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  assert.equal(version, 1);
  const columns = (check.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map((row) => row.name);
  assert.ok(columns.includes('owner_id'));
  assert.ok(columns.includes('owner'));
  check.close();
  assert.equal(db.countUsers(), 0);
  assert.equal(db.countOrphanProjects(), 1);
});

test('the first account adopts the legacy project and later accounts get their own', () => {
  const alice = db.createUser({
    username: 'alice',
    displayName: 'Alice',
    passwordHash: 'hash-a',
    role: 'admin',
  });
  assert.equal(alice.adopted, 1);
  assert.equal(alice.projectId, 'playground');
  const adopted = db.getProjectForUser(alice.user.id);
  assert.ok(adopted);
  assert.equal(adopted.id, 'playground');
  assert.equal(db.getFiles(adopted.id)[0]?.content, 'int main(){return 0;}');
  assert.equal(db.countOrphanProjects(), 0);

  const bob = db.createUser({
    username: 'bob',
    displayName: 'Bob',
    passwordHash: 'hash-b',
    role: 'user',
  });
  assert.equal(bob.adopted, 0);
  const bobProject = db.getProjectForUser(bob.user.id);
  assert.ok(bobProject);
  assert.notEqual(bobProject.id, 'playground');
  assert.ok(db.getFiles(bobProject.id).some((file) => file.path === 'main.cpp'));
});

test('run history is scoped to a project id', () => {
  const alice = db.getUserByUsername('alice')!;
  const bob = db.getUserByUsername('bob')!;
  const aliceProject = db.getProjectForUser(alice.id)!;
  const bobProject = db.getProjectForUser(bob.id)!;
  const result = {
    id: 'run-shared-id',
    status: 'OK' as const,
    exitCode: 0,
    signal: null,
    stdout: 'hello\n',
    stderr: '',
    compileOutput: '',
    diagnostics: [],
    timeMs: 4,
    compileTimeMs: 3,
    memoryKb: 128,
    createdAt: Date.now(),
    source: { entry: 'main.cpp', compiler: 'g++' as const, std: 'c++20' as const, opt: '-O0' as const, extraFlags: [] },
  };
  db.recordRun({ projectId: bobProject.id, kind: 'run', result, files: { 'main.cpp': 'int main(){}' }, stdin: '' });

  assert.equal(db.getRun(aliceProject.id, 'run-shared-id'), null);
  assert.equal(db.getRun(bobProject.id, 'run-shared-id')?.stdout, 'hello\n');
  assert.equal(db.listRuns(aliceProject.id).length, 0);
  assert.equal(db.listRuns(bobProject.id).length, 1);
});

test('session rows store only a token hash and can be revoked', () => {
  const alice = db.getUserByUsername('alice')!;
  const { session } = db.replaceAuthSession({
    userId: alice.id,
    tokenHash: 'sha256-of-some-random-token',
    expiresAt: Date.now() + 60_000,
    ip: '127.0.0.1',
    userAgent: 'test',
  });
  const found = db.findAuthSessionByTokenHash('sha256-of-some-random-token');
  assert.equal(found?.user.id, alice.id);
  assert.equal(found?.session.id, session.id);
  db.revokeAuthSession(session.id);
  const revoked = db.findAuthSessionByTokenHash('sha256-of-some-random-token');
  assert.ok(revoked?.session.revokedAt);
});

test('startup prunes duplicate active sessions and installs the unique index', () => {
  const alice = db.getUserByUsername('alice')!;
  const raw = new DatabaseSync(dbPath);
  raw.exec('DROP INDEX auth_sessions_single_active');
  const insert = raw.prepare(
    `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  );
  insert.run('old-session', alice.id, 'hash-old', 1000, 1000, Date.now() + 60_000);
  insert.run('new-session', alice.id, 'hash-new', 2000, 2000, Date.now() + 60_000);
  raw.close();

  db.initDb();

  const check = new DatabaseSync(dbPath);
  const active = check
    .prepare('SELECT id, revoked_at FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL')
    .all(alice.id) as Array<{ id: string; revoked_at: number | null }>;
  assert.deepEqual(active.map((row) => row.id), ['new-session']);
  const indexes = check.prepare("PRAGMA index_list('auth_sessions')").all() as Array<{ name: string }>;
  assert.ok(indexes.some((index) => index.name === 'auth_sessions_single_active'));
  check.close();
});

test('listUsers returns safe metadata and countAdmins tracks active admins', () => {
  const users = db.listUsers();
  assert.deepEqual(users.map((user) => user.username).sort(), ['alice', 'bob']);
  assert.equal(db.countAdmins(), 1);
  const bob = db.getUserByUsername('bob')!;
  db.setUserStatus(bob.id, 'disabled');
  assert.equal(db.getUserById(bob.id)?.status, 'disabled');
});
