#!/usr/bin/env node
/**
 * Security regression tests for the fixes documented in
 * docs/security-audit-2026-11-05.md (F-01 … F-07).
 *
 * Usage:
 *   npm run build
 *   node scripts/security-test.mjs
 *
 * Like smoke-test.mjs, this spawns an isolated backend (port 3102, temporary
 * DB/work root) and drives the public API. Covers the automated items of the
 * audit's §7 regression checklist:
 *   1. rootfs is read-only for the sandbox            (F-02)
 *   2. sandbox runs as host uid 10000, not the service user (F-01)
 *   3. x32 ABI + clone(CLONE_NEWUSER) are killed      (F-03)
 *   4. `.runstat` FIFO cannot block the event loop    (F-05)
 *   5. format never reads sandbox-controlled files    (F-04)
 *   6. ensureRootfs refuses planted symlinks          (F-06)
 *   7. cross-origin WebSocket upgrades are rejected   (F-07)
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.SEC_PORT ?? 3102);
const BASE = `http://127.0.0.1:${PORT}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplab-sec-'));
const dbPath = path.join(tempDir, 'sec.db');
const workRoot = path.join(tempDir, 'work');
const rootfsDir = path.join(ROOT, 'data', 'sandbox', 'rootfs');

let serverProcess;
let passed = 0;

function log(name, detail = '') {
  passed += 1;
  console.log(`  \u2713 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(endpoint, options = {}) {
  const response = await fetch(BASE + endpoint, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE + '/api/health');
      if (response.ok) return await response.json();
    } catch {
      // Still starting.
    }
    await delay(250);
  }
  throw new Error('server did not become ready');
}

async function runProgram(files, options = {}) {
  if (options.rateLimited !== false) await delay(1100);
  const response = await request('/api/run', {
    method: 'POST',
    body: JSON.stringify({
      files,
      entry: options.entry ?? 'main.cpp',
      compiler: 'g++',
      std: 'c++20',
      opt: '-O0',
      extraFlags: [],
      stdin: '',
      limits: { timeMs: options.timeMs ?? 3000, memoryMb: 256, outputBytes: 65536 },
    }),
  });
  if (response.status !== 202) {
    return { httpStatus: response.status, error: response.body?.error, result: null, done: Promise.resolve(null) };
  }
  const { runId, wsPath } = response.body;
  return { httpStatus: 202, runId, done: waitForRun(wsPath) };
}

function waitForRun(wsPath) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(BASE.replace('http', 'ws') + wsPath);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('run timeout'));
    }, 30_000);
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'result') {
        clearTimeout(timer);
        socket.close();
        resolve(event.result);
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function listRootfsEntries() {
  const entries = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      entries.push(prefix + name);
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(full, `${prefix}${name}/`);
    }
  };
  walk(rootfsDir, '');
  return entries.sort();
}

/** Scan /proc for jailed programs and return their host uids. */
function sandboxProcessUids(marker) {
  const uids = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // The nsjail launcher's argv also contains the marker (it passes the
      // program path); only processes inside the jail run as the sandbox uid.
      const comm = fs.readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
      if (comm === 'nsjail') continue;
      const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (!cmdline.includes(marker)) continue;
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      const match = /^Uid:\s+(\d+)/m.exec(status);
      if (match) uids.push(Number(match[1]));
    } catch {
      // Process vanished.
    }
  }
  return uids;
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'server.js'))) {
    throw new Error('dist/server.js missing; run npm run build first');
  }

  serverProcess = spawn(process.execPath, ['dist/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      WORK_ROOT: workRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  serverProcess.stdout.on('data', (chunk) => (serverLog += chunk.toString()));
  serverProcess.stderr.on('data', (chunk) => (serverLog += chunk.toString()));

  try {
    const health = await waitForServer();
    assert.equal(health.ok, true);
    assert.equal(health.capabilities.sandbox.available, true, health.capabilities.sandbox.detail);
    log('backend and sandbox ready');

    // ---- 1+2: uid isolation and read-only rootfs (F-01, F-02) ------------
    const before = listRootfsEntries();
    const probe = await runProgram({
      'main.cpp': `#include <unistd.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <cstdio>
int main() {
  printf("uid=%d\\n", getuid());
  int r1 = chmod("/", 0777);
  int fd1 = open("/pwned_sec", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  int fd2 = open("/etc/ld.so.preload", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  printf("chmod_root=%d open_pwned=%d open_preload=%d\\n", r1, fd1, fd2);
  return 0;
}
`,
    });
    const probeResult = await probe.done;
    assert.equal(probeResult.status, 'OK', JSON.stringify(probeResult));
    assert.match(probeResult.stdout, /uid=10000\b/);
    assert.match(probeResult.stdout, /chmod_root=-1/);
    assert.match(probeResult.stdout, /open_pwned=-1/);
    assert.match(probeResult.stdout, /open_preload=-1/);
    const after = listRootfsEntries();
    assert.deepEqual(after, before, 'shared rootfs was mutated by a jailed program');
    log('sandbox uid is 10000 and rootfs is read-only');

    // Host-side view: the jail process must not run as the service user.
    const sleeper = await runProgram(
      { 'main.cpp': '#include <unistd.h>\nint main(){ sleep(2); return 0; }\n' },
      { timeMs: 4000 },
    );
    let hostUids = [];
    for (let i = 0; i < 12 && hostUids.length === 0; i++) {
      await delay(250);
      hostUids = sandboxProcessUids('/workspace/prog');
    }
    await sleeper.done;
    assert.ok(hostUids.length > 0, 'no jailed process observed in /proc');
    assert.ok(
      hostUids.every((uid) => uid === 10000),
      `jailed processes run as host uid ${hostUids.join(',')}, expected 10000`,
    );
    log('jailed processes run as host uid 10000 (not the service user)');

    // ---- 3: x32 ABI and clone(CLONE_NEWUSER) are killed (F-03) ----------
    const seccomp = await runProgram({
      'main.cpp': `#define _GNU_SOURCE
#include <sched.h>
#include <sys/wait.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <cstdio>
static long x32(long nr, long a, long b, long c) { return syscall(0x40000000L + nr, a, b, c); }
static int childfn(void*) { return 0; }
static long probe(int which) {
  char stack[8192];
  switch (which) {
    case 0: return x32(165, 0, 0, 0);                 // x32 mount
    case 1: return x32(272, 0x10000000, 0, 0);        // x32 unshare(CLONE_NEWUSER)
    case 2: return x32(304, 0, 0, 0);                 // x32 open_by_handle_at
    case 3: return clone(childfn, stack + 8192, CLONE_NEWUSER | SIGCHLD, 0);
    default: return 0;
  }
}
int main() {
  for (int i = 0; i < 4; i++) {
    pid_t p = fork();
    if (p == 0) { long r = probe(i); printf("probe%d=ret:%ld\\n", i, r); fflush(stdout); _exit(0); }
    int st = 0; waitpid(p, &st, 0);
    if (WIFSIGNALED(st)) printf("probe%d=sig:%d\\n", i, WTERMSIG(st));
    else printf("probe%d=exit:%d\\n", i, WEXITSTATUS(st));
  }
  pid_t q = fork();
  if (q == 0) _exit(7);
  int st = 0; waitpid(q, &st, 0);
  printf("plain_fork=%d\\n", WEXITSTATUS(st) == 7 ? 1 : 0);
  return 0;
}
`,
    });
    const seccompResult = await seccomp.done;
    assert.equal(seccompResult.status, 'OK', JSON.stringify(seccompResult));
    for (let i = 0; i < 4; i++) {
      assert.match(
        seccompResult.stdout,
        new RegExp(`probe${i}=(sig:(9|31)|ret:-1)`),
        `probe${i} not blocked: ${seccompResult.stdout}`,
      );
      assert.doesNotMatch(seccompResult.stdout, new RegExp(`probe${i}=(ret:[0-9]|exit:0)`));
    }
    assert.match(seccompResult.stdout, /plain_fork=1/);
    log('x32 mount/unshare/open_by_handle_at and clone(NEWUSER) are blocked');

    // ---- 4: .runstat FIFO cannot block the service (F-05) ---------------
    const fifo = await runProgram(
      { 'main.cpp': '#include <sys/stat.h>\nint main(){ mkfifo("/workspace/.runstat", 0666); return 0; }\n' },
      { timeMs: 2000 },
    );
    let healthOk = false;
    for (let i = 0; i < 12 && !healthOk; i++) {
      await delay(500);
      try {
        const res = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(1500) });
        healthOk = res.ok;
      } catch {
        // Event loop still blocked; keep polling.
      }
    }
    assert.ok(healthOk, 'service stayed blocked on a .runstat FIFO');
    const fifoResult = await fifo.done;
    assert.ok(fifoResult, 'fifo run produced no result');
    log('`.runstat` FIFO does not block the event loop', `run status=${fifoResult.status}`);

    // ---- 5: format result comes from stdin/stdout only (F-04) -----------
    const format = await request('/api/format', {
      method: 'POST',
      body: JSON.stringify({ file: 'main.cpp', content: 'int main(){int x=1; if(x){return 0;} return 1;}' }),
    });
    assert.equal(format.status, 200);
    assert.equal(format.body.changed, true);
    assert.match(format.body.formatted, /\n {4}int x = 1;/);
    assert.doesNotMatch(format.body.formatted, /CANARY|root:x:0:0/, 'format leaked host file content');
    log('format pipeline reads no sandbox-controlled file');

    // ---- 6: ensureRootfs refuses planted symlinks (F-06) ----------------
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplab-sec-rootfs-'));
    fs.mkdirSync(path.join(scratch, 'data', 'sandbox'), { recursive: true });
    const probeRun = spawnSync(
      path.join(ROOT, 'node_modules', '.bin', 'tsx'),
      [path.join(ROOT, 'scripts', 'security-ensure-rootfs.mts'), scratch],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(probeRun.status, 0, `ensure-rootfs probe failed:\n${probeRun.stdout}\n${probeRun.stderr}`);
    fs.rmSync(scratch, { recursive: true, force: true });
    log('ensureRootfs refuses planted symlinks');

    // ---- 7: cross-origin WS upgrades are rejected (F-07) ----------------
    const evil = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/run/00000000-0000-0000-0000-000000000000`, {
        headers: { Origin: 'http://evil.example' },
      });
      let opened = false;
      ws.on('open', () => {
        opened = true;
        ws.close();
        resolve({ opened });
      });
      ws.on('error', () => resolve({ opened }));
      ws.on('close', () => resolve({ opened }));
    });
    assert.equal(evil.opened, false, 'cross-origin WebSocket upgrade was accepted');
    const sameOrigin = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/run/00000000-0000-0000-0000-000000000000`, {
        headers: { Origin: `http://127.0.0.1:${PORT}` },
      });
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
    });
    assert.equal(sameOrigin, true, 'same-origin WebSocket upgrade was rejected');
    log('cross-origin WS upgrade rejected, same-origin accepted');

    console.log(`\n${passed} security checks passed.`);
  } catch (error) {
    console.error('\nSecurity test failed:', error);
    if (serverLog) console.error(serverLog.slice(-3000));
    process.exitCode = 1;
  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await delay(500);
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
