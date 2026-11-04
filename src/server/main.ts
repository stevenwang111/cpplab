import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { ApiError } from './util/errors.js';
import { RateLimiter } from './util/rateLimiter.js';
import { detectCapabilities } from './capabilities.js';
import { ensureRootfs } from './sandbox/rootfs.js';
import {
  COMPILERS,
  OPTS,
  STDS,
  type CompilerId,
  type OptId,
  type StdId,
} from '../shared/types.js';
import {
  deleteFile,
  getFiles,
  getFilesMap,
  getProject,
  getRun,
  initDb,
  listRuns,
  replaceFiles,
  updateProjectSettings,
  upsertFile,
} from './db.js';
import { normalizeFilePath, validateDebugStart, validateFiles, validateFormatRequest, validateRunRequest } from './validation.js';
import { buildPrepared, attachRunSocket, getRunSession, startRun } from './runService.js';
import { formatSource } from './compile/runner.js';
import {
  getDebugSession,
  listDebugSessions,
  shutdownDebugSessions,
  startDebugSession,
  stopDebugSession,
} from './debug/session.js';
import { audit } from './util/audit.js';

const limiter = new RateLimiter(config.limits.rateLimitPerSecond, config.limits.rateLimitBurst);
const rateSweeper = setInterval(() => limiter.sweep(), 60_000);
rateSweeper.unref();

function projectState() {
  return {
    project: getProject(),
    files: getFiles(),
    capabilities: capabilities!,
  };
}

let capabilities: Awaited<ReturnType<typeof detectCapabilities>> | undefined;

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function enforceRate(req: Request): void {
  if (!limiter.take(clientKey(req))) {
    throw new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试');
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'runtime'), { recursive: true });
  ensureRootfs();
  initDb();
  capabilities = await detectCapabilities();
  audit({
    event: 'startup',
    sandbox: capabilities.sandbox,
    tools: capabilities.tools,
  });

  const app = express();
  app.set('trust proxy', false);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: config.maxBodyBytes }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      serverTime: Date.now(),
      capabilities,
      debugSessions: listDebugSessions(),
    });
  });

  app.get('/api/project', (_req, res) => {
    res.json(projectState());
  });

  app.patch('/api/project', (req, res, next) => {
    try {
      const body = req.body as { settings?: Record<string, unknown>; name?: unknown };
      const current = getProject();
      const settings = { ...current.settings };
      if (body.settings) {
        if (body.settings.entry !== undefined) {
          const entry = normalizeFilePath(body.settings.entry);
          if (!getFiles().some((file) => file.path === entry)) {
            throw new ApiError(400, 'ENTRY_MISSING', `入口文件不存在：${entry}`);
          }
          settings.entry = entry;
        }
        if (body.settings.compiler !== undefined) {
          if (!COMPILERS.includes(body.settings.compiler as CompilerId)) {
            throw new ApiError(400, 'INVALID_REQUEST', 'compiler 取值不合法');
          }
          settings.compiler = body.settings.compiler as CompilerId;
        }
        if (body.settings.std !== undefined) {
          if (!STDS.includes(body.settings.std as StdId)) {
            throw new ApiError(400, 'INVALID_REQUEST', 'std 取值不合法');
          }
          settings.std = body.settings.std as StdId;
        }
        if (body.settings.opt !== undefined) {
          if (!OPTS.includes(body.settings.opt as OptId)) {
            throw new ApiError(400, 'INVALID_REQUEST', 'opt 取值不合法');
          }
          settings.opt = body.settings.opt as OptId;
        }
      }
      let name: string | undefined;
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 60) {
          throw new ApiError(400, 'INVALID_REQUEST', '项目名长度需在 1-60 字符之间');
        }
        name = body.name.trim();
      }
      const project = updateProjectSettings(settings, name);
      res.json({ project });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/files', (req, res, next) => {
    try {
      const body = req.body as { path?: unknown; content?: unknown };
      const filePath = normalizeFilePath(body.path);
      if (typeof body.content !== 'string') {
        throw new ApiError(400, 'INVALID_REQUEST', 'content 必须是字符串');
      }
      if (Buffer.byteLength(body.content) > config.limits.maxSourceBytes) {
        throw new ApiError(413, 'SOURCE_TOO_LARGE', '单个文件超过大小上限');
      }
      const existing = getFiles();
      if (!existing.some((file) => file.path === filePath) && existing.length >= config.limits.maxFiles) {
        throw new ApiError(400, 'TOO_MANY_FILES', `文件数量不能超过 ${config.limits.maxFiles} 个`);
      }
      upsertFile(filePath, body.content);
      res.json({ ok: true, path: filePath });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/files/*', (req, res, next) => {
    try {
      const filePath = normalizeFilePath(String((req.params as Record<string, string | string[]>)[0]));
      const files = getFiles();
      if (!files.some((file) => file.path === filePath)) {
        throw new ApiError(404, 'FILE_NOT_FOUND', '文件不存在');
      }
      if (files.length <= 1) {
        throw new ApiError(400, 'LAST_FILE', '至少保留一个文件');
      }
      if (getProject().settings.entry === filePath) {
        throw new ApiError(400, 'ENTRY_FILE', '不能删除入口文件');
      }
      deleteFile(filePath);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/format', asyncRoute(async (req, res) => {
    enforceRate(req);
    const { file, content } = validateFormatRequest(req.body);
    const result = await formatSource(file, content);
    res.json(result);
  }));

  app.post('/api/run', (req, res, next) => {
    try {
      enforceRate(req);
      const validated = validateRunRequest(req.body);
      if (!capabilities?.compilers.some((item) => item.id === validated.compiler && item.available)) {
        throw new ApiError(400, 'COMPILER_UNAVAILABLE', `${validated.compiler} 未安装`);
      }
      const prepared = buildPrepared({
        files: validated.files.map,
        entry: validated.files.entry,
        compiler: validated.compiler,
        std: validated.std,
        opt: validated.opt,
        extraFlags: validated.extraFlags,
        stdin: validated.stdin,
        limits: validated.limits,
      });
      const { runId } = startRun(prepared);
      audit({
        event: 'run.start',
        runId,
        entry: validated.files.entry,
        compiler: validated.compiler,
        std: validated.std,
        opt: validated.opt,
        flags: validated.extraFlags,
        sourceBytes: validated.files.sourceBytes,
      });
      res.status(202).json({ runId, wsPath: `/ws/run/${runId}` });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/run/:id', (req, res, next) => {
    try {
      const session = getRunSession(req.params.id);
      if (session) {
        res.json({ runId: session.id, done: session.done, result: session.result ?? null });
        return;
      }
      const stored = getRun(req.params.id);
      if (!stored) throw new ApiError(404, 'RUN_NOT_FOUND', '运行记录不存在');
      res.json({ runId: stored.id, done: true, result: stored });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs', (req, res, next) => {
    try {
      const limit = Number(req.query.limit ?? 40);
      res.json({ runs: listRuns(Number.isFinite(limit) ? limit : 40) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:id', (req, res, next) => {
    try {
      const run = getRun(req.params.id);
      if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', '运行记录不存在');
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/runs/:id/restore', (req, res, next) => {
    try {
      const run = getRun(req.params.id);
      if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', '运行记录不存在');
      const validated = validateFiles(run.files, run.source.entry);
      replaceFiles(validated.files, run.source);
      res.json(projectState());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/debug/start', asyncRoute(async (req, res) => {
    enforceRate(req);
    const validated = validateDebugStart(req.body);
    if (!capabilities?.compilers.some((item) => item.id === validated.compiler && item.available)) {
      throw new ApiError(400, 'COMPILER_UNAVAILABLE', `${validated.compiler} 未安装`);
    }
    const outcome = await startDebugSession({
      files: validated.files.map,
      fileList: validated.files.files,
      entry: validated.files.entry,
      compiler: validated.compiler,
      std: validated.std,
      extraFlags: validated.extraFlags,
    });
    if (!outcome.ok) {
      res.json({ status: 'CE', diagnostics: outcome.diagnostics, compileOutput: outcome.compileOutput });
      return;
    }
    audit({ event: 'debug.start', sessionId: outcome.response.sessionId, entry: validated.files.entry });
    res.status(201).json(outcome.response);
  }));

  app.get('/api/debug', (_req, res) => {
    res.json({ sessions: listDebugSessions() });
  });

  app.post('/api/debug/:id/stop', asyncRoute(async (req, res) => {
    const stopped = await stopDebugSession(String(req.params.id));
    if (!stopped) throw new ApiError(404, 'SESSION_NOT_FOUND', '调试会话不存在');
    audit({ event: 'debug.stop', sessionId: String(req.params.id) });
    res.json({ ok: true });
  }));

  app.use('/api', (_req, _res, next) => {
    next(new ApiError(404, 'NOT_FOUND', '接口不存在'));
  });

  const clientDir = config.clientDir;
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(
      express.static(clientDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
          else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send('CppLab backend is running. Start Vite with `npm run dev` or build the client.');
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, detail: error.detail },
      });
      return;
    }
    if (error instanceof SyntaxError && 'status' in error && (error as { status?: number }).status === 400) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: '请求 JSON 格式错误' } });
      return;
    }
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 500;
    if (status === 413) {
      res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: '请求体过大' } });
      return;
    }
    console.error('[api] unhandled error', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const runMatch = /^\/ws\/run\/([0-9a-f-]+)$/i.exec(url.pathname);
    const debugMatch = /^\/ws\/debug\/([0-9a-f-]+)$/i.exec(url.pathname);
    if (!runMatch && !debugMatch) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (runMatch) {
        const session = getRunSession(runMatch[1]);
        if (!session) {
          ws.close(4004, 'run not found');
          return;
        }
        attachRunSocket(session, ws);
      } else if (debugMatch) {
        const session = getDebugSession(debugMatch[1]);
        if (!session) {
          ws.close(4004, 'session not found');
          return;
        }
        session.attach(ws);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const alive = (ws as WebSocket & { isAlive?: boolean }).isAlive;
      if (alive === false) {
        ws.terminate();
        continue;
      }
      (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  wss.on('connection', (ws) => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on('pong', () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  console.log(`[cpplab] listening on http://${config.host}:${config.port}`);
  console.log(
    `[cpplab] sandbox=${capabilities.sandbox.available ? 'ready' : 'unavailable'} formatter=${capabilities.tools.formatter} debugger=${capabilities.tools.debugger}`,
  );
  if (!capabilities.sandbox.available) console.warn(`[cpplab] sandbox: ${capabilities.sandbox.detail}`);
  if (!capabilities.tools.formatter) console.warn('[cpplab] clang-format is unavailable');
  if (!capabilities.tools.debugger) console.warn('[cpplab] lldb-dap is unavailable');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cpplab] shutting down (${signal})`);
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    await shutdownDebugSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[cpplab] fatal startup error', error);
  process.exit(1);
});
