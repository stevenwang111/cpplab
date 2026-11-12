/**
 * Local persistence.
 *
 * The IDE used to keep projects, files and run history in SQLite behind an
 * HTTP API. With the server gone, IndexedDB takes over: same three entities,
 * same shapes, but the data never leaves the browser. There is no quota
 * accounting beyond pruning the history to the newest 60 runs.
 */
import type {
  FileEntry,
  Project,
  ProjectSettings,
  RunDetail,
  RunSourceMeta,
  RunStatus,
  RunSummary,
} from '../../shared/types';
import { t } from '../i18n';

const DB_NAME = 'cpplab';
const DB_VERSION = 1;
const PROJECT_ID = 'playground';
const HISTORY_LIMIT = 60;

const STORE_PROJECT = 'project';
const STORE_FILES = 'files';
const STORE_RUNS = 'runs';

interface FileRow {
  path: string;
  content: string;
}

interface RunRow {
  id: string;
  status: RunStatus;
  exitCode: number | null;
  signal: number | null;
  stdout: string;
  stderr: string;
  compileOutput: string;
  diagnostics: string;
  timeMs: number;
  compileTimeMs: number;
  memoryKb: number;
  createdAt: number;
  source: string;
  files: string;
  stdin: string;
  sourceBytes: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECT)) db.createObjectStore(STORE_PROJECT, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        const runs = db.createObjectStore(STORE_RUNS, { keyPath: 'id' });
        runs.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
  return db.transaction(name, mode).objectStore(name);
}

/** Starter project, written once on first visit. */
function seedSource(): string {
  const comment = t('app.seed.comment');
  return `#include <algorithm>
#include <iostream>
#include <vector>

using namespace std;

// ${comment}
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
}

export async function getProject(): Promise<Project> {
  const db = await openDatabase();
  const existing = (await requestToPromise(store(db, STORE_PROJECT).get(PROJECT_ID))) as Project | undefined;
  if (existing) return existing;

  const now = Date.now();
  const project: Project = {
    id: PROJECT_ID,
    name: t('app.seed.projectName'),
    settings: { entry: 'main.cpp', compiler: 'clang++', std: 'c++20', opt: '-O0' },
    createdAt: now,
    updatedAt: now,
  };
  await requestToPromise(store(db, STORE_PROJECT, 'readwrite').put(project));
  await putFile('main.cpp', seedSource());
  return project;
}

export async function updateProject(patch: Partial<ProjectSettings>, name?: string): Promise<Project> {
  const project = await getProject();
  const next: Project = {
    ...project,
    name: name ?? project.name,
    settings: { ...project.settings, ...patch },
    updatedAt: Date.now(),
  };
  const db = await openDatabase();
  await requestToPromise(store(db, STORE_PROJECT, 'readwrite').put(next));
  return next;
}

export async function listFiles(): Promise<FileEntry[]> {
  const db = await openDatabase();
  const rows = (await requestToPromise(store(db, STORE_FILES).getAll())) as FileRow[];
  return rows.map((row) => ({ path: row.path, content: row.content })).sort((a, b) => a.path.localeCompare(b.path));
}

export async function putFile(path: string, content: string): Promise<void> {
  const db = await openDatabase();
  await requestToPromise(store(db, STORE_FILES, 'readwrite').put({ path, content }));
}

export async function deleteFileRow(path: string): Promise<void> {
  const db = await openDatabase();
  await requestToPromise(store(db, STORE_FILES, 'readwrite').delete(path));
}

/** Replace the whole workspace with a snapshot (used by history restore). */
export async function replaceFiles(files: Record<string, string>): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_FILES, 'readwrite');
  const target = transaction.objectStore(STORE_FILES);
  // All writes are queued synchronously: awaiting inside the transaction would
  // let it auto-commit between operations.
  target.clear();
  for (const [path, content] of Object.entries(files)) {
    target.put({ path, content });
  }
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

export interface RunRecord {
  run: RunDetail;
  sourceBytes: number;
}

export async function insertRun(record: RunRecord): Promise<void> {
  const db = await openDatabase();
  const row: RunRow = {
    ...record.run,
    diagnostics: JSON.stringify(record.run.diagnostics),
    source: JSON.stringify(record.run.source),
    files: JSON.stringify(record.run.files),
    sourceBytes: record.sourceBytes,
  };
  await requestToPromise(store(db, STORE_RUNS, 'readwrite').put(row));
  await pruneHistory(db);
}

async function pruneHistory(db: IDBDatabase): Promise<void> {
  const rows = (await requestToPromise(store(db, STORE_RUNS).getAll())) as RunRow[];
  if (rows.length <= HISTORY_LIMIT) return;
  rows.sort((a, b) => b.createdAt - a.createdAt);
  const transaction = db.transaction(STORE_RUNS, 'readwrite');
  const target = transaction.objectStore(STORE_RUNS);
  for (const row of rows.slice(HISTORY_LIMIT)) target.delete(row.id);
}

export async function listRuns(limit: number): Promise<RunSummary[]> {
  const db = await openDatabase();
  const rows = (await requestToPromise(store(db, STORE_RUNS).getAll())) as RunRow[];
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      timeMs: row.timeMs,
      memoryKb: row.memoryKb,
      source: JSON.parse(row.source) as RunSourceMeta,
      sourceBytes: row.sourceBytes,
    }));
}

export async function getRun(id: string): Promise<RunDetail | null> {
  const db = await openDatabase();
  const row = (await requestToPromise(store(db, STORE_RUNS).get(id))) as RunRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    exitCode: row.exitCode,
    signal: row.signal,
    stdout: row.stdout,
    stderr: row.stderr,
    compileOutput: row.compileOutput,
    diagnostics: JSON.parse(row.diagnostics),
    timeMs: row.timeMs,
    compileTimeMs: row.compileTimeMs,
    memoryKb: row.memoryKb,
    createdAt: row.createdAt,
    source: JSON.parse(row.source) as RunSourceMeta,
    files: JSON.parse(row.files) as Record<string, string>,
    stdin: row.stdin,
  };
}
