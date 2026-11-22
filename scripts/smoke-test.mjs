#!/usr/bin/env node
/**
 * End-to-end smoke test for multi-user auth, the sandbox, run pipeline,
 * formatter and debugger.
 *
 * Usage:
 *   npm run build
 *   node scripts/smoke-test.mjs
 *
 * The script starts an isolated backend on port 3101 with a temporary SQLite
 * database and work root, bootstraps an admin, then drives the public
 * HTTP/WebSocket API with real session cookies. There is no auth bypass path.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.SMOKE_PORT ?? 3101);
const BASE = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
const ADMIN_USER = 'alice';
const ADMIN_PASSWORD = 'smoke-admin-password';
const BOB_USER = 'bob';
const BOB_PASSWORD = 'smoke-bob-password';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplab-smoke-'));
const dbPath = path.join(tempDir, 'smoke.db');
const workRoot = path.join(tempDir, 'work');

let serverProcess;
let passed = 0;
let capabilities;

function log(name, detail = '') {
  passed += 1;
  console.log(`  \u2713 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HttpClient {
  constructor() {
    this.cookies = new Map();
    this.lastSetCookie = [];
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  snapshotCookies() {
    return new Map(this.cookies);
  }

  restoreCookies(snapshot) {
    this.cookies = new Map(snapshot);
  }

  absorbCookies(response) {
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    this.lastSetCookie = list;
    for (const raw of list) {
      const pair = raw.split(';')[0];
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = /max-age=0/i.test(raw) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(endpoint, options = {}) {
    const method = options.method ?? 'GET';
    const headers = {
      'Content-Type': 'application/json',
      'Accept-Language': options.locale ?? 'en',
      ...(options.headers ?? {}),
    };
    if (options.origin !== false && method !== 'GET') headers.Origin = options.origin ?? ORIGIN;
    const cookie = options.cookie === false ? '' : this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(BASE + endpoint, {
      method,
      headers,
      body: options.body,
      redirect: 'manual',
    });
    this.absorbCookies(response);
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body, headers: response.headers };
  }

  async login(username, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      origin: ORIGIN,
    });
  }
}

const anon = new HttpClient();
const alice = new HttpClient();
let bob = new HttpClient();

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE + '/api/health');
      if (response.ok) return await response.json();
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error('server did not become ready');
}

async function runProgram(files, options = {}) {
  if (options.rateLimited !== false) await delay(1100);
  const response = await alice.request('/api/run', {
    method: 'POST',
    body: JSON.stringify({
      files,
      entry: options.entry ?? 'main.cpp',
      compiler: options.compiler ?? 'g++',
      std: options.std ?? 'c++20',
      opt: options.opt ?? '-O0',
      extraFlags: options.extraFlags ?? [],
      stdin: options.stdin ?? '',
      limits: { timeMs: options.timeMs ?? 2000, memoryMb: options.memoryMb ?? 256, outputBytes: options.outputBytes ?? 65536 },
    }),
  });
  if (response.status !== 202) {
    return { httpStatus: response.status, error: response.body?.error, result: null };
  }
  const { runId, wsPath } = response.body;
  const result = await waitForRun(wsPath, alice);
  return { httpStatus: 202, runId, result };
}

function waitForRun(wsPath, client) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(BASE.replace('http', 'ws') + wsPath, {
      headers: { Cookie: client.cookieHeader(), Origin: ORIGIN },
    });
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
      } else if (event.type === 'error') {
        // The final result still carries the status; keep waiting for it.
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Resolve with the WebSocket close code (or 'refused' for an HTTP failure). */
function expectWsClose(wsPath, cookie, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(BASE.replace('http', 'ws') + wsPath, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: ORIGIN },
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WS did not close: ${wsPath}`));
    }, timeoutMs);
    socket.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve('refused');
    });
  });
}

async function formatTest() {
  if (!capabilities.tools.formatter) return log('clang-format skipped (not installed)');
  await delay(1100);
  const response = await alice.request('/api/format', {
    method: 'POST',
    body: JSON.stringify({ file: 'main.cpp', content: 'int main(){int x=1; if(x){return 0;} return 1;}' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.changed, true);
  assert.match(response.body.formatted, /\n {4}int x = 1;/);
  log('clang-format sandboxed formatting');
}

class DapSession {
  constructor(wsPath, client) {
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    this.output = '';
    this.socket = new WebSocket(BASE.replace('http', 'ws') + wsPath, {
      headers: { Cookie: client.cookieHeader(), Origin: ORIGIN },
    });
    this.socket.on('message', (data) => this.onMessage(JSON.parse(data.toString())));
  }

  onMessage(message) {
    if (message.type === 'response') {
      const pending = this.pending.get(message.request_seq);
      if (!pending) return;
      this.pending.delete(message.request_seq);
      clearTimeout(pending.timer);
      if (message.success) pending.resolve(message);
      else pending.reject(new Error(message.message ?? `${message.command} failed`));
      return;
    }
    if (message.type === 'event') {
      this.events.push(message);
      if (message.event === 'output') this.output += message.body?.output ?? '';
    }
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(command, args, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      this.seq += 1;
      const seq = this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP timeout: ${command}`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ seq, type: 'request', command, arguments: args }));
    });
  }

  async waitEvent(name, timeoutMs = 15_000) {
    const existing = this.events.find((event) => event.event === name);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`event timeout: ${name}`)), timeoutMs);
      const interval = setInterval(() => {
        const found = this.events.find((event) => event.event === name);
        if (found) {
          clearTimeout(timer);
          clearInterval(interval);
          resolve(found);
        }
      }, 20);
    });
  }

  close() {
    this.socket.close();
  }
}

async function debugTest() {
  if (!capabilities.tools.debugger) return log('debugger skipped (lldb-dap not installed)');
  await delay(1100);
  const files = {
    'main.cpp': `#include <iostream>\nstruct Point { int x; int y; };\nint add(int a, int b) { int sum = a + b; return sum; }\nint main() {\n    Point p{4, 5};\n    int result = add(p.x, p.y);\n    std::cout << "result=" << result << "\\n";\n    return 0;\n}\n`,
  };
  const start = await alice.request('/api/debug/start', {
    method: 'POST',
    body: JSON.stringify({ files, entry: 'main.cpp', compiler: 'g++', std: 'c++20', extraFlags: [] }),
  });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const sessionId = start.body.sessionId;
  const wsPath = `/ws/debug/${sessionId}`;

  // The per-user debug slot is already held, so a second session is refused.
  await delay(1100);
  const busyDebug = await alice.request('/api/debug/start', {
    method: 'POST',
    body: JSON.stringify({ files, entry: 'main.cpp', compiler: 'g++', std: 'c++20', extraFlags: [] }),
  });
  assert.equal(busyDebug.status, 429, JSON.stringify(busyDebug.body));
  assert.equal(busyDebug.body.error.code, 'DEBUG_BUSY');

  // Cross-user access must be rejected before the session is attached.
  const bobStop = await bob.request(`/api/debug/${sessionId}/stop`, { method: 'POST', body: '{}' });
  assert.equal(bobStop.status, 404, JSON.stringify(bobStop.body));
  assert.equal(await expectWsClose(wsPath, bob.cookieHeader()), 4403);
  assert.equal(await expectWsClose(wsPath, ''), 4401);
  const bobList = await bob.request('/api/debug');
  assert.deepEqual(bobList.body.sessions, []);

  const dap = new DapSession(wsPath, alice);
  await dap.open();
  const init = await dap.send('initialize', {
    adapterID: 'lldb-dap',
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: 'path',
  });
  assert.equal(init.success, true);
  const bp = await dap.send('setBreakpoints', {
    source: { path: '/workspace/main.cpp' },
    breakpoints: [{ line: 6 }],
    sourceModified: false,
  });
  assert.equal(bp.success, true);
  const launch = await dap.send('launch', { program: '/workspace/prog', cwd: '/workspace', stopOnEntry: false });
  assert.equal(launch.success, true, launch.message);
  await dap.send('configurationDone', {});
  const stopped = await dap.waitEvent('stopped');
  assert.equal(stopped.body.reason, 'breakpoint');
  const stack = await dap.send('stackTrace', { threadId: stopped.body.threadId, startFrame: 0, levels: 10 });
  const frames = stack.body.stackFrames;
  assert.ok(frames.length > 0);
  assert.equal(frames[0].source.path, '/workspace/main.cpp');
  assert.equal(frames[0].name, 'main');
  const scopes = await dap.send('scopes', { frameId: frames[0].id });
  const locals = scopes.body.scopes.find((scope) => /locals/i.test(scope.name));
  assert.ok(locals);
  const variables = await dap.send('variables', { variablesReference: locals.variablesReference });
  assert.ok(variables.body.variables.some((variable) => variable.name === 'p'));
  await dap.send('continue', { threadId: stopped.body.threadId });
  await dap.waitEvent('terminated', 20_000);
  assert.match(dap.output, /result=9/);
  dap.close();

  // Bob still cannot stop a session that belonged to alice, even after it ends.
  const bobStopAfter = await bob.request(`/api/debug/${sessionId}/stop`, { method: 'POST', body: '{}' });
  assert.equal(bobStopAfter.status, 404);
  log('DAP breakpoint, stack, variables and cross-user rejection');
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
      ALLOW_BOOTSTRAP: '1',
      BOOTSTRAP_ADMIN_USERNAME: ADMIN_USER,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  serverProcess.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  try {
    const health = await waitForServer();
    capabilities = health.capabilities;
    assert.equal(health.ok, true);
    assert.equal(health.capabilities.sandbox.available, true, health.capabilities.sandbox.detail);
    assert.ok(health.capabilities.compilers.some((compiler) => compiler.id === 'g++' && compiler.available));
    assert.equal('debugSessions' in health, false);
    log('backend and sandbox ready', health.capabilities.sandbox.detail);

    // --- authentication -------------------------------------------------
    const unauthenticated = await anon.request('/api/project');
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error.code, 'AUTH_REQUIRED');

    const noOrigin = await anon.request('/api/auth/login', {
      method: 'POST',
      origin: false,
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    });
    assert.equal(noOrigin.status, 403);
    assert.equal(noOrigin.body.error.code, 'CSRF_ORIGIN');

    const crossOrigin = await anon.request('/api/files', {
      method: 'POST',
      origin: 'https://evil.example',
      body: JSON.stringify({ path: 'x.cpp', content: 'x' }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.body.error.code, 'CSRF_ORIGIN');
    log('unauthenticated access and Origin enforcement');

    const wrong = await anon.login(ADMIN_USER, 'not-the-password');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

    const login = await alice.login(ADMIN_USER, ADMIN_PASSWORD);
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.user.username, ADMIN_USER);
    assert.equal(login.body.user.role, 'admin');
    const setCookie = login.headers.getSetCookie().join('\n');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\//);
    assert.doesNotMatch(setCookie, /Secure/i);
    log('login, uniform failure and HttpOnly session cookie');

    const me = await alice.request('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, ADMIN_USER);
    assert.equal('passwordHash' in me.body.user, false);

    // The database stores only the SHA-256 of the token and the scrypt hash.
    const rawToken = alice.cookies.get('cpplab_session');
    assert.ok(rawToken);
    const inspect = new DatabaseSync(dbPath);
    const sessionRow = inspect.prepare('SELECT token_hash FROM auth_sessions LIMIT 1').get();
    assert.match(sessionRow.token_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(sessionRow.token_hash, rawToken);
    const userRow = inspect.prepare('SELECT password_hash FROM users WHERE username = ?').get(ADMIN_USER);
    assert.match(userRow.password_hash, /^scrypt\$32768\$8\$1\$/);
    assert.doesNotMatch(userRow.password_hash, new RegExp(ADMIN_PASSWORD));
    inspect.close();
    assert.equal(fs.statSync(dbPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(tempDir).mode & 0o777, 0o700);
    log('token/password hashes at rest and 0700/0600 permissions');

    const project = await alice.request('/api/project');
    assert.equal(project.status, 200);
    assert.ok(project.body.files.some((file) => file.path === 'main.cpp'));
    const aliceProjectId = project.body.project.id;
    log('project bootstrap for the signed-in user');

    const createBob = await alice.request('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username: BOB_USER, password: BOB_PASSWORD, role: 'user' }),
    });
    assert.equal(createBob.status, 201, JSON.stringify(createBob.body));
    assert.equal(createBob.body.user.mustChangePassword, false);
    const bobLogin = await bob.login(BOB_USER, BOB_PASSWORD);
    assert.equal(bobLogin.status, 200);
    const bobProject = await bob.request('/api/project');
    assert.equal(bobProject.status, 200);
    assert.notEqual(bobProject.body.project.id, aliceProjectId);
    assert.equal(bobProject.body.files.length, 1);
    log('admin-created account and separate personal project');

    // One account = one device: the second login wins and the first cookie dies.
    const bobSecond = new HttpClient();
    const bobSecondLogin = await bobSecond.login(BOB_USER, BOB_PASSWORD);
    assert.equal(bobSecondLogin.status, 200, JSON.stringify(bobSecondLogin.body));
    assert.equal((await bob.request('/api/project')).status, 401);
    const sessionInspect = new DatabaseSync(dbPath);
    const activeBobSessions = sessionInspect
      .prepare(
        `SELECT COUNT(*) AS n FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE u.username = ? AND s.revoked_at IS NULL`,
      )
      .get(BOB_USER);
    sessionInspect.close();
    assert.equal(activeBobSessions.n, 1);
    bob = bobSecond;
    log('a second login revokes the first device session');

    // One account cannot queue a second run behind its first one.
    await delay(1100);
    const longRun = await alice.request('/api/run', {
      method: 'POST',
      body: JSON.stringify({
        files: { 'main.cpp': 'int main(){ volatile unsigned long long x=0; while(1){x++;} }\n' },
        entry: 'main.cpp',
        compiler: 'g++',
        std: 'c++20',
        opt: '-O0',
        extraFlags: [],
        stdin: '',
        limits: { timeMs: 5000, memoryMb: 256, outputBytes: 65536 },
      }),
    });
    assert.equal(longRun.status, 202, JSON.stringify(longRun.body));
    await delay(1100);
    const busyRun = await alice.request('/api/run', {
      method: 'POST',
      body: JSON.stringify({
        files: { 'main.cpp': 'int main(){return 0;}\n' },
        entry: 'main.cpp',
        compiler: 'g++',
        std: 'c++20',
        opt: '-O0',
        extraFlags: [],
        stdin: '',
        limits: { timeMs: 1000, memoryMb: 256, outputBytes: 65536 },
      }),
    });
    assert.equal(busyRun.status, 429, JSON.stringify(busyRun.body));
    assert.equal(busyRun.body.error.code, 'USER_BUSY');
    const longResult = await waitForRun(longRun.body.wsPath, alice);
    assert.equal(longResult.status, 'TLE');
    log('per-user run slot returns USER_BUSY while a run is active');

    const hello = await runProgram(
      {
        'main.cpp':
          '#include <iostream>\nint main(){int a,b; if(!(std::cin>>a>>b)) return 2; std::cout<<"sum="<<a+b<<"\\n"; return 0;}\n',
      },
      { stdin: '2 3\n' },
    );
    assert.equal(hello.result.status, 'OK');
    assert.equal(hello.result.stdout, 'sum=5\n');
    log('sandboxed compile and run', `${hello.result.timeMs} ms`);

    // --- cross-user IDOR ------------------------------------------------
    const bobRun = await bob.request(`/api/run/${hello.runId}`);
    assert.equal(bobRun.status, 404);
    const bobRunDetail = await bob.request(`/api/runs/${hello.runId}`);
    assert.equal(bobRunDetail.status, 404);
    const bobRestore = await bob.request(`/api/runs/${hello.runId}/restore`, { method: 'POST', body: '{}' });
    assert.equal(bobRestore.status, 404);
    assert.equal(await expectWsClose(`/ws/run/${hello.runId}`, bob.cookieHeader()), 4403);
    assert.equal(await expectWsClose(`/ws/run/${hello.runId}`, ''), 4401);
    const bobRuns = await bob.request('/api/runs');
    assert.deepEqual(bobRuns.body.runs, []);
    log('cross-user run/restore access returns 404 and WS close 4403');

    // Disabling an account must also tear down an already-open run socket.
    await delay(1100);
    const bobRunStart = await bob.request('/api/run', {
      method: 'POST',
      body: JSON.stringify({
        files: { 'main.cpp': '#include <unistd.h>\nint main(){sleep(3);return 0;}\n' },
        entry: 'main.cpp',
        compiler: 'g++',
        std: 'c++20',
        opt: '-O0',
        extraFlags: [],
        stdin: '',
        limits: { timeMs: 5000, memoryMb: 256, outputBytes: 65536 },
      }),
    });
    assert.equal(bobRunStart.status, 202, JSON.stringify(bobRunStart.body));
    const bobSocket = new WebSocket(BASE.replace('http', 'ws') + bobRunStart.body.wsPath, {
      headers: { Cookie: bob.cookieHeader(), Origin: ORIGIN },
    });
    await new Promise((resolve, reject) => {
      bobSocket.once('open', resolve);
      bobSocket.once('error', reject);
    });
    const bobSocketClosed = new Promise((resolve) => bobSocket.once('close', (code) => resolve(code)));
    const disableBob = await alice.request(`/api/admin/users/${createBob.body.user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
    });
    assert.equal(disableBob.status, 200, JSON.stringify(disableBob.body));
    assert.equal(await bobSocketClosed, 4401);
    assert.equal((await bob.request('/api/project')).status, 401);
    const enableBob = await alice.request(`/api/admin/users/${createBob.body.user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(enableBob.status, 200);
    await delay(3500); // let bob's sandbox run finish and release its slot
    bob.cookies.clear();
    const bobRelogin = await bob.login(BOB_USER, BOB_PASSWORD);
    assert.equal(bobRelogin.status, 200);
    log('disabling an account closes its live WebSocket with 4401');

    const compileError = await runProgram({ 'main.cpp': 'int main(){ return missing_symbol; }\n' });
    assert.equal(compileError.result.status, 'CE');
    assert.ok(compileError.result.diagnostics.some((item) => item.file === 'main.cpp' && item.severity === 'error'));
    log('compile diagnostics');

    const tle = await runProgram(
      { 'main.cpp': 'int main(){ volatile unsigned long long x=0; while(1){x++;} }\n' },
      { timeMs: 1000 },
    );
    assert.equal(tle.result.status, 'TLE');
    assert.ok(tle.result.timeMs <= 3500, `TLE took ${tle.result.timeMs} ms`);
    assert.ok([9, 15, 24].includes(tle.result.signal), `unexpected TLE signal ${tle.result.signal}`);
    const residual = spawnSync('pgrep', ['-f', '/workspace/prog'], { encoding: 'utf8' });
    assert.equal(residual.stdout.trim(), '', `orphan process: ${residual.stdout}`);
    log('wall-clock timeout and process-group cleanup');

    const ole = await runProgram(
      {
        'main.cpp':
          '#include <cstdio>\nint main(){for(;;) puts("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");}\n',
      },
      { timeMs: 3000, outputBytes: 4096 },
    );
    assert.equal(ole.result.status, 'OLE');
    assert.ok(ole.result.stdout.length <= 4200);
    log('output cap');

    const mle = await runProgram(
      { 'main.cpp': '#include <vector>\nint main(){std::vector<char> v(300ull*1024*1024); volatile char c=v[0]; return c;}\n' },
      { timeMs: 5000 },
    );
    assert.equal(mle.result.status, 'MLE');
    log('cgroup memory limit', `${mle.result.memoryKb} KB peak`);

    const escape = await runProgram({
      'main.cpp': '#include <cstdlib>\nint main(){system("cat /etc/passwd");return 0;}\n',
    });
    assert.equal(escape.result.status, 'OK');
    assert.match(escape.result.stdout, /sandbox:x:10000/);
    assert.doesNotMatch(escape.result.stdout, /steven/);
    assert.doesNotMatch(escape.result.stdout, /\/home\/steven/);
    log('fake /etc/passwd inside jail');

    const deniedInclude = await runProgram({ 'main.cpp': '#include </etc/hostname>\nint main(){return 0;}\n' });
    assert.equal(deniedInclude.result.status, 'CE');
    log('host include path unavailable');

    const network = await runProgram({
      'main.cpp':
        '#include <cstdio>\n#include <sys/socket.h>\n#include <arpa/inet.h>\nint main(){int s=socket(AF_INET,SOCK_STREAM,0); sockaddr_in a{}; a.sin_family=AF_INET; a.sin_port=htons(80); inet_pton(AF_INET,"1.1.1.1",&a.sin_addr); int r=connect(s,(sockaddr*)&a,sizeof(a)); printf("connect=%d\\n",r); return 0;}\n',
    });
    assert.equal(network.result.status, 'OK');
    assert.match(network.result.stdout, /connect=-1/);
    assert.ok(network.result.stderr === '' || /unreachable|denied/i.test(network.result.stderr));
    log('sandboxed external connection attempt fails');

    const blockedFlag = await runProgram({ 'main.cpp': 'int main(){return 0;}\n' }, { extraFlags: ['-fplugin=/tmp/x.so'] });
    assert.equal(blockedFlag.httpStatus, 400);
    assert.equal(blockedFlag.error.code, 'FLAG_NOT_ALLOWED');
    log('compiler flag allowlist');

    const multi = await runProgram(
      {
        'main.cpp': '#include <iostream>\n#include "util.h"\nint main(){std::cout<<add(2,3)<<"\\n";return 0;}\n',
        'util.h': '#pragma once\ninline int add(int a,int b){return a+b;}\n',
      },
      { compiler: health.capabilities.compilers.some((compiler) => compiler.id === 'clang++' && compiler.available) ? 'clang++' : 'g++' },
    );
    assert.equal(multi.result.status, 'OK');
    assert.equal(multi.result.stdout, '5\n');
    log('multi-file project');

    await formatTest();
    await debugTest();

    const runs = await alice.request('/api/runs');
    assert.equal(runs.status, 200);
    assert.ok(runs.body.runs.length >= 3);
    const okRun = runs.body.runs.find((run) => run.status === 'OK');
    assert.ok(okRun);
    const restore = await alice.request(`/api/runs/${okRun.id}/restore`, { method: 'POST', body: '{}' });
    assert.equal(restore.status, 200);
    assert.ok(restore.body.files.some((file) => file.path === 'main.cpp'));
    log('SQLite history and snapshot restore');

    // --- forced password change and session rotation --------------------
    const createCharlie = await alice.request('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'charlie', role: 'user' }),
    });
    assert.equal(createCharlie.status, 201);
    assert.ok(createCharlie.body.initialPassword);
    assert.equal(createCharlie.body.user.mustChangePassword, true);
    const charlie = new HttpClient();
    const charlieLogin = await charlie.login('charlie', createCharlie.body.initialPassword);
    assert.equal(charlieLogin.status, 200);
    const blocked = await charlie.request('/api/project');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
    const changed = await charlie.request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: createCharlie.body.initialPassword,
        newPassword: 'charlie-password-1',
      }),
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.user.mustChangePassword, false);
    const charlieProject = await charlie.request('/api/project');
    assert.equal(charlieProject.status, 200);
    log('forced password change blocks the workspace until completed');

    const bobCookiesBefore = bob.snapshotCookies();
    const bobChange = await bob.request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: BOB_PASSWORD, newPassword: 'bob-password-2' }),
    });
    assert.equal(bobChange.status, 200);
    const stale = new HttpClient();
    stale.restoreCookies(bobCookiesBefore);
    assert.equal((await stale.request('/api/project')).status, 401);
    assert.equal((await bob.request('/api/project')).status, 200);
    log('password change revokes the old session and issues a new one');

    // --- logout ---------------------------------------------------------
    const bobLogout = await bob.request('/api/auth/logout', { method: 'POST', body: '{}' });
    assert.equal(bobLogout.status, 200);
    assert.equal((await bob.request('/api/project')).status, 401);
    log('logout clears the cookie and invalidates the session');

    // --- login flood ----------------------------------------------------
    let sawRateLimit = false;
    for (let index = 0; index < 7; index += 1) {
      const attempt = await anon.login(`ghost${index}`, 'wrong-password');
      if (attempt.status === 429) sawRateLimit = true;
    }
    assert.equal(sawRateLimit, true);
    log('login flood is rate-limited');

    const aliceLogout = await alice.request('/api/auth/logout', { method: 'POST', body: '{}' });
    assert.equal(aliceLogout.status, 200);
    assert.equal((await alice.request('/api/project')).status, 401);

    console.log(`\n${passed} checks passed.`);
  } catch (error) {
    console.error('\nSmoke test failed:', error);
    if (serverLog) console.error(serverLog.slice(-4000));
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
