import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { ApiError, msg } from './util/errors.js';
import { RateLimiter } from './util/rateLimiter.js';
import { detectCapabilities, localizeCapabilities } from './capabilities.js';
import { ensureRootfs } from './sandbox/rootfs.js';
import { localeMiddleware, resolveI18nText } from './locale.js';
import { DEFAULT_LOCALE, renderText, type Locale } from '../shared/i18n/index.js';
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

/** Project payload rendered in the caller's language, including seeded text. */
function projectState(locale: Locale) {
  const project = getProject();
  return {
    project: { ...project, name: resolveI18nText(project.name, locale) },
    files: getFiles().map((file) => ({ ...file, content: resolveI18nText(file.content, locale) })),
    capabilities: localizeCapabilities(capabilities!, locale),
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

/** F-07: session listings are only shown to loopback clients. */
function isLoopback(req: Request): boolean {
  const ip = req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.');
}

/**
 * F-07: reject cross-origin WebSocket upgrades. Browsers always send an Origin
 * header on WS upgrades; a remote page must not attach to local sessions.
 * Same-host origins (any port, e.g. the vite dev proxy) are accepted.
 */
function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // Non-browser clients (tests, CLI) send no Origin.
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname;
  const loopback = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
  return loopback || parsed.host === host;
}

function enforceRate(req: Request): void {
  if (!limiter.take(clientKey(req))) {
    throw new ApiError(429, 'RATE_LIMITED', msg('err.rateLimited'));
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
    sandbox: localizeCapabilities(capabilities, DEFAULT_LOCALE).sandbox,
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
  app.use(localeMiddleware);
  app.use(express.json({ limit: config.maxBodyBytes }));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      serverTime: Date.now(),
      capabilities: localizeCapabilities(capabilities!, req.locale),
      debugSessions: isLoopback(req) ? listDebugSessions() : [],
    });
  });

  app.get('/api/project', (req, res) => {
    res.json(projectState(req.locale));
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
            throw new ApiError(400, 'ENTRY_MISSING', msg('err.entryMissing', { entry }));
          }
          settings.entry = entry;
        }
        if (body.settings.compiler !== undefined) {
          if (!COMPILERS.includes(body.settings.compiler as CompilerId)) {
            throw new ApiError(400, 'INVALID_REQUEST', msg('err.enumInvalid', { field: 'compiler' }));
          }
          settings.compiler = body.settings.compiler as CompilerId;
        }
        if (body.settings.std !== undefined) {
          if (!STDS.includes(body.settings.std as StdId)) {
            throw new ApiError(400, 'INVALID_REQUEST', msg('err.enumInvalid', { field: 'std' }));
          }
          settings.std = body.settings.std as StdId;
        }
        if (body.settings.opt !== undefined) {
          if (!OPTS.includes(body.settings.opt as OptId)) {
            throw new ApiError(400, 'INVALID_REQUEST', msg('err.enumInvalid', { field: 'opt' }));
          }
          settings.opt = body.settings.opt as OptId;
        }
      }
      let name: string | undefined;
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 60) {
          throw new ApiError(400, 'INVALID_REQUEST', msg('err.projectNameLength'));
        }
        name = body.name.trim();
      }
      const project = updateProjectSettings(settings, name);
      res.json({ project: { ...project, name: resolveI18nText(project.name, req.locale) } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/files', (req, res, next) => {
    try {
      const body = req.body as { path?: unknown; content?: unknown };
      const filePath = normalizeFilePath(body.path);
      if (typeof body.content !== 'string') {
        throw new ApiError(400, 'INVALID_REQUEST', msg('err.contentNotString'));
      }
      if (Buffer.byteLength(body.content) > config.limits.maxSourceBytes) {
        throw new ApiError(413, 'SOURCE_TOO_LARGE', msg('err.fileTooLarge'));
      }
      const existing = getFiles();
      if (!existing.some((file) => file.path === filePath) && existing.length >= config.limits.maxFiles) {
        throw new ApiError(400, 'TOO_MANY_FILES', msg('err.tooManyFiles', { max: config.limits.maxFiles }));
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
        throw new ApiError(404, 'FILE_NOT_FOUND', msg('err.fileMissing'));
      }
      if (files.length <= 1) {
        throw new ApiError(400, 'LAST_FILE', msg('err.lastFile'));
      }
      if (getProject().settings.entry === filePath) {
        throw new ApiError(400, 'ENTRY_FILE', msg('err.entryFile'));
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
    const result = await formatSource(file, content, req.locale);
    res.json(result);
  }));

  app.post('/api/run', (req, res, next) => {
    try {
      enforceRate(req);
      const validated = validateRunRequest(req.body);
      if (!capabilities?.compilers.some((item) => item.id === validated.compiler && item.available)) {
        throw new ApiError(400, 'COMPILER_UNAVAILABLE', msg('err.compilerMissing', { compiler: validated.compiler }));
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
        locale: req.locale,
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
      if (!stored) throw new ApiError(404, 'RUN_NOT_FOUND', msg('err.runNotFound'));
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
      if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', msg('err.runNotFound'));
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/runs/:id/restore', (req, res, next) => {
    try {
      const run = getRun(req.params.id);
      if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', msg('err.runNotFound'));
      const validated = validateFiles(run.files, run.source.entry);
      replaceFiles(validated.files, run.source);
      res.json(projectState(req.locale));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/debug/start', asyncRoute(async (req, res) => {
    enforceRate(req);
    const validated = validateDebugStart(req.body);
    if (!capabilities?.compilers.some((item) => item.id === validated.compiler && item.available)) {
      throw new ApiError(400, 'COMPILER_UNAVAILABLE', msg('err.compilerMissing', { compiler: validated.compiler }));
    }
    const outcome = await startDebugSession({
      files: validated.files.map,
      fileList: validated.files.files,
      entry: validated.files.entry,
      compiler: validated.compiler,
      std: validated.std,
      extraFlags: validated.extraFlags,
      locale: req.locale,
    });
    if (!outcome.ok) {
      res.json({ status: 'CE', diagnostics: outcome.diagnostics, compileOutput: outcome.compileOutput });
      return;
    }
    audit({ event: 'debug.start', sessionId: outcome.response.sessionId, entry: validated.files.entry });
    res.status(201).json(outcome.response);
  }));

  // F-07: session ids are attach credentials; only expose them to loopback.
  app.get('/api/debug', (req, res) => {
    res.json({ sessions: isLoopback(req) ? listDebugSessions() : [] });
  });

  app.post('/api/debug/:id/stop', asyncRoute(async (req, res) => {
    const stopped = await stopDebugSession(String(req.params.id));
    if (!stopped) throw new ApiError(404, 'SESSION_NOT_FOUND', msg('err.debugSessionNotFound'));
    audit({ event: 'debug.stop', sessionId: String(req.params.id) });
    res.json({ ok: true });
  }));

  app.use('/api', (_req, _res, next) => {
    next(new ApiError(404, 'NOT_FOUND', msg('err.apiNotFound')));
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

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.localized(req.locale),
          detail: error.detail ? renderText(error.detail, req.locale) : undefined,
        },
      });
      return;
    }
    if (error instanceof SyntaxError && 'status' in error && (error as { status?: number }).status === 400) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: renderText({ key: 'err.invalidJson' }, req.locale) } });
      return;
    }
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 500;
    if (status === 413) {
      res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: renderText({ key: 'err.bodyTooLarge' }, req.locale) } });
      return;
    }
    console.error('[api] unhandled error', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: renderText({ key: 'err.internal' }, req.locale) } });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    // F-07: cross-origin pages must not attach to run/debug sessions.
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!originAllowed(origin, req.headers.host)) {
      socket.destroy();
      return;
    }
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
  if (!capabilities.sandbox.available) {
    console.warn(`[cpplab] sandbox: ${renderText(capabilities.sandbox.detail, DEFAULT_LOCALE)}`);
  }
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
