#!/usr/bin/env node
/**
 * End-to-end smoke test for the sandbox, run pipeline, formatter and debugger.
 *
 * Usage:
 *   npm run build
 *   node scripts/smoke-test.mjs
 *
 * The script starts an isolated backend on port 3101 with a temporary SQLite
 * database and work root, then drives the public HTTP/WebSocket API.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.SMOKE_PORT ?? 3101);
const BASE = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${PORT}`;
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
      // The server is still starting.
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
  const result = await waitForRun(wsPath);
  return { httpStatus: 202, runId, result };
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

async function formatTest() {
  if (!capabilities.tools.formatter) return log('clang-format skipped (not installed)');
  await delay(1100);
  const response = await request('/api/format', {
    method: 'POST',
    body: JSON.stringify({ file: 'main.cpp', content: 'int main(){int x=1; if(x){return 0;} return 1;}' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.changed, true);
  assert.match(response.body.formatted, /\n {4}int x = 1;/);
  log('clang-format sandboxed formatting');
}

class DapSession {
  constructor(wsPath) {
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    this.output = '';
    this.socket = new WebSocket(BASE.replace('http', 'ws') + wsPath);
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
  const start = await request('/api/debug/start', {
    method: 'POST',
    body: JSON.stringify({ files, entry: 'main.cpp', compiler: 'g++', std: 'c++20', extraFlags: [] }),
  });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const sessionId = start.body.sessionId;
  const dap = new DapSession(`/ws/debug/${sessionId}`);
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
  log('DAP breakpoint, stack, variables and program output');
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
    log('backend and sandbox ready', health.capabilities.sandbox.detail);

    const project = await request('/api/project');
    assert.equal(project.status, 200);
    assert.ok(project.body.files.some((file) => file.path === 'main.cpp'));
    log('project bootstrap');

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
    log('network namespace has no route');

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

    const runs = await request('/api/runs');
    assert.equal(runs.status, 200);
    assert.ok(runs.body.runs.length >= 3);
    const okRun = runs.body.runs.find((run) => run.status === 'OK');
    assert.ok(okRun);
    const restore = await request(`/api/runs/${okRun.id}/restore`, { method: 'POST', body: '{}' });
    assert.equal(restore.status, 200);
    assert.ok(restore.body.files.some((file) => file.path === 'main.cpp'));
    log('SQLite history and snapshot restore');

    console.log(`\n${passed} checks passed.`);
  } catch (error) {
    console.error('\nSmoke test failed:', error);
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
