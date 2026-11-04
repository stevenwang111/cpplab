import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { WebSocket } from 'ws';
import type {
  DebugSessionSummary,
  DebugStartResponse,
  Diagnostic,
} from '../../shared/types.js';
import { config } from '../config.js';
import { ApiError, SandboxUnavailableError } from '../util/errors.js';
import { Semaphore } from '../util/semaphore.js';
import { compileSemaphore } from '../util/semaphores.js';
import { compileWorkspace, type CompileInput } from '../compile/runner.js';
import {
  cleanupWorkdir,
  startDebugSandbox,
  terminateDebugSandbox,
  withInit,
  type DebugSandboxHandle,
} from '../sandbox/nsjail.js';
import { createDebugSessionRow, endDebugSession, newId, touchDebugSession } from '../db.js';
import { audit } from '../util/audit.js';

const debugSemaphore = new Semaphore(config.limits.maxDebugSessions);

export interface DebugStartInput {
  files: Record<string, string>;
  fileList: Array<{ path: string; content: string }>;
  entry: string;
  compiler: CompileInput['compiler'];
  std: CompileInput['std'];
  extraFlags: string[];
}

export interface DebugStartResult {
  response: DebugStartResponse;
}

export type DebugStartOutcome =
  | { ok: true; response: DebugStartResponse }
  | { ok: false; diagnostics: Diagnostic[]; compileOutput: string };

class DapFrameParser {
  private buffer = Buffer.alloc(0);
  private readonly maxFrame = 8 * 1024 * 1024;

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > this.maxFrame) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      if (this.buffer.length < headerEnd + 4 + length) break;
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length);
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      try {
        messages.push(JSON.parse(body.toString('utf8')));
      } catch {
        // A malformed frame from the adapter is dropped; the session stays up.
      }
    }
    return messages;
  }
}

function frameDap(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

class DebugSession {
  readonly startedAt = Date.now();
  lastActive = Date.now();
  private idleTimer: NodeJS.Timeout;
  private hardTimer: NodeJS.Timeout;
  private socket?: WebSocket;
  private ended = false;
  private cleaned = false;
  private lastDbTouch = 0;
  private programOutputBytes = 0;
  private outputLimitHit = false;
  private readonly parser = new DapFrameParser();
  private stderrBuffer = '';
  private readonly release: () => void;
  private readonly handle: DebugSandboxHandle;
  private readonly onExit: () => void;

  constructor(
    readonly id: string,
    readonly workdir: string,
    handle: DebugSandboxHandle,
    release: () => void,
  ) {
    this.handle = handle;
    this.release = release;
    this.idleTimer = setTimeout(() => this.expire('空闲超时（5 分钟无操作）'), config.limits.debugIdleTimeoutMs);
    this.hardTimer = setTimeout(() => this.expire('会话超过 30 分钟上限'), config.limits.debugHardTimeoutMs);
    this.idleTimer.unref();
    this.hardTimer.unref();

    handle.child.stdout?.on('data', (chunk: Buffer) => this.handleAdapterData(chunk));
    handle.child.stderr?.on('data', (chunk: Buffer) => this.handleAdapterLog(chunk));
    this.onExit = () => this.handleExit();
    handle.child.once('close', this.onExit);
    handle.child.once('error', this.onExit);

    createDebugSessionRow(this.id, handle.child.pid ?? null);
  }

  attach(socket: WebSocket): void {
    if (this.ended) {
      socket.close(4001, 'session ended');
      return;
    }
    if (this.socket && this.socket.readyState === 1) {
      socket.close(4009, 'session already attached');
      return;
    }
    this.socket = socket;
    socket.send(
      JSON.stringify({
        type: 'ide-event',
        event: 'attached',
        body: { sessionId: this.id, program: config.debug.programPath, cwd: config.debug.sandboxCwd },
      }),
    );
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.touch();
      const text = data.toString();
      if (text.length > 8 * 1024 * 1024) {
        socket.close(4008, 'message too large');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.sendConsole('客户端发送了非法 JSON');
        return;
      }
      this.writeToAdapter(parsed);
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined;
      void this.terminate('客户端断开');
    });
    socket.on('error', () => {
      void this.terminate('客户端连接错误');
    });
  }

  private touch(): void {
    this.lastActive = Date.now();
    if (Date.now() - this.lastDbTouch < 5000) return;
    this.lastDbTouch = Date.now();
    try {
      touchDebugSession(this.id);
    } catch {
      // Session bookkeeping is best effort.
    }
  }

  private writeToAdapter(message: unknown): void {
    const child = this.handle.child;
    if (!child.stdin || child.stdin.destroyed) return;
    try {
      child.stdin.write(frameDap(message));
      this.touch();
    } catch {
      this.sendConsole('调试适配器的输入管道已关闭');
    }
  }

  private handleAdapterData(chunk: Buffer): void {
    this.touch();
    const messages = this.parser.push(chunk);
    for (const message of messages) {
      if (
        !this.outputLimitHit &&
        message &&
        typeof message === 'object' &&
        (message as { type?: string }).type === 'event' &&
        (message as { event?: string }).event === 'output'
      ) {
        const body = (message as { body?: { category?: string; output?: string } }).body;
        if (body?.category === 'stdout' || body?.category === 'stderr') {
          this.programOutputBytes += Buffer.byteLength(body.output ?? '');
          if (this.programOutputBytes > config.limits.maxOutputBytes) {
            this.outputLimitHit = true;
            this.sendConsole('程序输出超过 64 KiB，调试会话已终止');
            void this.terminate('程序输出超过上限');
            return;
          }
        }
      }
      if (this.socket && this.socket.readyState === 1) {
        this.socket.send(JSON.stringify(message));
      }
    }
  }

  private handleAdapterLog(chunk: Buffer): void {
    this.stderrBuffer += chunk.toString('utf8');
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      this.sendConsole(`[lldb-dap] ${line}`);
    }
  }

  private sendConsole(text: string): void {
    if (this.socket && this.socket.readyState === 1) {
      this.socket.send(JSON.stringify({ type: 'ide-log', level: 'info', message: text }));
    }
  }

  private handleExit(): void {
    if (this.ended) return;
    this.sendConsole('调试适配器已退出');
    if (this.socket && this.socket.readyState === 1) {
      this.socket.send(JSON.stringify({ seq: 0, type: 'event', event: 'terminated', body: {} }));
      this.socket.close(1000, 'debug adapter exited');
    }
    void this.cleanup();
  }

  private expire(reason: string): void {
    if (this.ended) return;
    this.sendConsole(reason);
    if (this.socket && this.socket.readyState === 1) {
      this.socket.close(4000, reason);
    }
    void this.terminate(reason);
  }

  async terminate(reason: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.hardTimer);
    if (this.socket && this.socket.readyState === 1) {
      this.socket.close(4000, reason);
    }
    terminateDebugSandbox(this.handle);
    await waitForExit(this.handle.child, 1200);
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.cleaned) return;
    this.cleaned = true;
    this.ended = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.hardTimer);
    this.handle.child.removeListener('close', this.onExit);
    this.handle.cleanup();
    cleanupWorkdir(this.workdir);
    try {
      endDebugSession(this.id);
      audit({ event: 'debug.end', sessionId: this.id });
    } catch {
      // Ignore.
    }
    sessions.delete(this.id);
    this.release();
  }

  summary(): DebugSessionSummary {
    return {
      id: this.id,
      state: this.ended ? 'ended' : this.socket ? 'active' : 'starting',
      startedAt: this.startedAt,
      lastActive: this.lastActive,
    };
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const onClose = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener('close', onClose);
      resolve();
    }, timeoutMs);
    child.once('close', onClose);
  });
}

const sessions = new Map<string, DebugSession>();

export async function startDebugSession(input: DebugStartInput): Promise<DebugStartOutcome> {
  if (!config.tools.lldbDap) {
    throw new ApiError(503, 'DEBUGGER_UNAVAILABLE', 'lldb-dap 未安装');
  }
  const release = await debugSemaphore.acquire();
  let workdir: string | undefined;
  try {
    const releaseCompile = await compileSemaphore.acquire();
    let compile: Awaited<ReturnType<typeof compileWorkspace>>;
    try {
      compile = await compileWorkspace({
        files: input.fileList,
        entry: input.entry,
        compiler: input.compiler,
        std: input.std,
        opt: '-O0',
        extraFlags: input.extraFlags,
        debug: true,
      });
    } finally {
      releaseCompile();
    }
    workdir = compile.workdir;
    if (!compile.ok) {
      cleanupWorkdir(compile.workdir);
      release();
      return { ok: false, diagnostics: compile.diagnostics, compileOutput: compile.compileOutput };
    }

    const handle = startDebugSandbox(compile.workdir, withInit([config.tools.lldbDap]));
    const id = newId();
    const session = new DebugSession(id, compile.workdir, handle, release);
    sessions.set(id, session);
    return {
      ok: true,
      response: {
        sessionId: id,
        status: 'OK',
        entry: input.entry,
        program: config.debug.programPath,
        cwd: config.debug.sandboxCwd,
        compileTimeMs: compile.compileTimeMs,
      },
    };
  } catch (error) {
    release();
    if (workdir) cleanupWorkdir(workdir);
    if (error instanceof SandboxUnavailableError || error instanceof ApiError) throw error;
    throw new ApiError(500, 'DEBUG_START_FAILED', '启动调试会话失败', String(error));
  }
}

export function getDebugSession(id: string): DebugSession | undefined {
  return sessions.get(id);
}

export async function stopDebugSession(id: string): Promise<boolean> {
  const session = sessions.get(id);
  if (!session) return false;
  await session.terminate('会话已停止');
  return true;
}

export function listDebugSessions(): DebugSessionSummary[] {
  return [...sessions.values()].map((session) => session.summary());
}

export async function shutdownDebugSessions(): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.terminate('服务器关闭')));
}

