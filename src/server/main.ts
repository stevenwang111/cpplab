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
  type Project,
  type StdId,
} from '../shared/types.js';
import {
  cleanupAuthSessions,
  countOrphanProjects,
  countUsers,
  deleteFile,
  getFiles,
  getProjectForUser,
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
import { userRequestLimiter } from './util/userQuota.js';
import { loginLimiter } from './auth/loginLimiter.js';
import {
  bootstrapAdminIfConfigured,
  changePassword,
  createUserByAdmin,
  listAdminUsers,
  login,
  logout,
  resetUserPassword,
  updateUserRole,
  updateUserStatus,
} from './auth/service.js';
import {
  attachAuth,
  requireAdmin,
  requireAuth,
  requirePasswordChanged,
  requireSameOrigin,
  wsOriginAllowed,
} from './auth/middleware.js';
import {
  authenticateToken,
  authenticateTokenHash,
  clearSessionCookie,
  cookieSecure,
  hashToken,
  parseCookies,
  sessionCookieFor,
} from './auth/session.js';

const limiter = new RateLimiter(config.limits.rateLimitPerSecond, config.limits.rateLimitBurst);
const rateSweeper = setInterval(() => {
  limiter.sweep();
  userRequestLimiter.sweep();
  loginLimiter.sweep();
}, 60_000);
rateSweeper.unref();

/** Sessions are cheap to keep for a week but must not accumulate forever. */
const sessionCleaner = setInterval(() => {
  try {
    cleanupAuthSessions();
  } catch {
    // Cleanup is best effort.
  }
}, 60 * 60 * 1000);
sessionCleaner.unref();

let capabilities: Awaited<ReturnType<typeof detectCapabilities>> | undefined;
/** Set when legacy projects still have no owner; the API then fails closed. */
let orphanProjectsBlocked = false;

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
    throw new ApiError(429, 'RATE_LIMITED', msg('err.rateLimited'));
  }
}

function enforceUserRate(req: Request): void {
  if (!req.user) return;
  if (!userRequestLimiter.take(`user:${req.user.id}`)) {
    throw new ApiError(429, 'RATE_LIMITED', msg('err.rateLimited'));
  }
}

/** The caller's own project; the client never supplies a project id. */
function projectFor(req: Request): Project {
  const project = req.user ? getProjectForUser(req.user.id) : null;
  if (!project) throw new ApiError(500, 'PROJECT_MISSING', msg('err.projectMissing'));
  return project;
}

/** Project payload rendered in the caller's language, including seeded text. */
function projectState(project: Project, locale: Locale) {
  return {
    project: { ...project, name: resolveI18nText(project.name, locale) },
    files: getFiles(project.id).map((file) => ({ ...file, content: resolveI18nText(file.content, locale) })),
    capabilities: localizeCapabilities(capabilities!, locale),
  };
}

function requireProjectForUser(req: Request, res: Response, next: NextFunction): void {
  if (!orphanProjectsBlocked) {
    next();
    return;
  }
  if ((req.originalUrl.split('?')[0] ?? '').startsWith('/api/auth/')) {
    next();
    return;
  }
  next(new ApiError(503, 'ORPHAN_PROJECTS', msg('err.orphanProjects')));
}

/**
 * WebSocket sessions can outlive the cookie session (admin disable, password
 * reset). Re-validate at most every five seconds so message floods cannot turn
 * the check itself into database load.
 */
function authProbe(tokenHash: string | undefined): () => boolean {
  let checkedAt = 0;
  let authorized = true;
  return () => {
    if (!tokenHash) return false;
    const now = Date.now();
    if (now - checkedAt < 5000) return authorized;
    checkedAt = now;
    authorized = authenticateTokenHash(tokenHash) !== null;
    return authorized;
  };
}

function healthPayload(locale: Locale) {
  return {
    ok: true,
    serverTime: Date.now(),
    capabilities: localizeCapabilities(capabilities!, locale),
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(config.dataDir, 'runtime'), { recursive: true, mode: 0o700 });
  ensureRootfs();
  initDb();
  await bootstrapAdminIfConfigured();
  if (countUsers() === 0) {
    console.warn(
      '[cpplab] no user accounts exist; create the first admin with `npm run user:add -- <name> --admin`',
    );
  }
  if (countUsers() > 0 && countOrphanProjects() > 0) {
    orphanProjectsBlocked = true;
    console.error(
      `[cpplab] ${countOrphanProjects()} project(s) have owner_id IS NULL; refusing business API access. ` +
        'Reassign them to an account before serving users.',
    );
  }
  try {
    cleanupAuthSessions();
  } catch {
    // Best effort.
  }
  capabilities = await detectCapabilities();
  audit({
    event: 'startup',
    sandbox: localizeCapabilities(capabilities, DEFAULT_LOCALE).sandbox,
    tools: capabilities.tools,
    authUsers: countUsers(),
    orphanProjects: countOrphanProjects(),
  });

  const app = express();
  app.set('trust proxy', config.auth.trustProxy);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(localeMiddleware);

  // CSRF: every state-changing API request must carry a same-origin Origin,
  // including login (login CSRF) and before any body is parsed.
  app.use('/api', requireSameOrigin);

  app.get('/api/health', (req, res) => {
    res.json(healthPayload(req.locale));
  });

  // The login body is parsed with its own small limit, before the generic
  // 3 MiB parser and before attachAuth (multi-user-auth.md §5).
  app.post(
    '/api/auth/login',
    express.json({ limit: '8kb' }),
    asyncRoute(async (req, res) => {
      const body = req.body as { username?: unknown; password?: unknown } | undefined;
      const username = typeof body?.username === 'string' ? body.username : '';
      const ip = clientKey(req);
      const gate = loginLimiter.check(ip, username);
      if (!gate.allowed) {
        res.setHeader('Retry-After', String(gate.retryAfterSeconds));
        throw new ApiError(429, 'RATE_LIMITED', msg('err.loginRateLimited'));
      }
      try {
        const result = await login(body?.username, body?.password, req);
        loginLimiter.recordSuccess(result.user.username);
        res.setHeader('Set-Cookie', sessionCookieFor(req, result.issued));
        res.json({ user: result.user });
      } catch (error) {
        loginLimiter.recordFailure(username);
        throw error;
      }
    }),
  );

  // Authentication is resolved from the cookie only; body parsing happens later.
  app.use('/api', attachAuth, requireAuth, requireProjectForUser, requirePasswordChanged);
  app.use(express.json({ limit: config.maxBodyBytes }));

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.user && req.authSessionId) logout(req.authSessionId, req.user);
    res.setHeader('Set-Cookie', clearSessionCookie(cookieSecure(req)));
    res.json({ ok: true });
  });

  app.post(
    '/api/auth/password',
    asyncRoute(async (req, res) => {
      const body = req.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
      const result = await changePassword(req.authUserRecord!, body?.currentPassword, body?.newPassword, req);
      res.setHeader('Set-Cookie', sessionCookieFor(req, result.issued));
      res.json({ user: result.user });
    }),
  );

  // --- admin (CLI is the primary path; the API exists for later UI work) ---
  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    res.json({ users: listAdminUsers() });
  });

  app.post(
    '/api/admin/users',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as { username?: unknown; displayName?: unknown; role?: unknown; password?: unknown };
      const created = await createUserByAdmin(body, req.authUserRecord!);
      res.status(201).json(created);
    }),
  );

  app.patch('/api/admin/users/:id', requireAdmin, (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { status?: unknown; role?: unknown };
      let user = req.user!;
      if (body.status !== undefined) user = updateUserStatus(req.authUserRecord!, String(req.params.id), body.status);
      if (body.role !== undefined) user = updateUserRole(req.authUserRecord!, String(req.params.id), body.role);
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/admin/users/:id/reset-password',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const result = await resetUserPassword(req.authUserRecord!, String(req.params.id));
      res.json(result);
    }),
  );

  app.get('/api/project', (req, res) => {
    res.json(projectState(projectFor(req), req.locale));
  });

  app.patch('/api/project', (req, res, next) => {
    try {
      const project = projectFor(req);
      const body = req.body as { settings?: Record<string, unknown>; name?: unknown };
      const settings = { ...project.settings };
      if (body.settings) {
        if (body.settings.entry !== undefined) {
          const entry = normalizeFilePath(body.settings.entry);
          if (!getFiles(project.id).some((file) => file.path === entry)) {
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
      const updated = updateProjectSettings(project.id, settings, name);
      res.json({ project: { ...updated, name: resolveI18nText(updated.name, req.locale) } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/files', (req, res, next) => {
    try {
      const project = projectFor(req);
      const body = req.body as { path?: unknown; content?: unknown };
      const filePath = normalizeFilePath(body.path);
      if (typeof body.content !== 'string') {
        throw new ApiError(400, 'INVALID_REQUEST', msg('err.contentNotString'));
      }
      if (Buffer.byteLength(body.content) > config.limits.maxSourceBytes) {
        throw new ApiError(413, 'SOURCE_TOO_LARGE', msg('err.fileTooLarge'));
      }
      const existing = getFiles(project.id);
      if (!existing.some((file) => file.path === filePath) && existing.length >= config.limits.maxFiles) {
        throw new ApiError(400, 'TOO_MANY_FILES', msg('err.tooManyFiles', { max: config.limits.maxFiles }));
      }
      upsertFile(project.id, filePath, body.content);
      res.json({ ok: true, path: filePath });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/files/*', (req, res, next) => {
    try {
      const project = projectFor(req);
      const filePath = normalizeFilePath(String((req.params as Record<string, string | string[]>)[0]));
      const files = getFiles(project.id);
      if (!files.some((file) => file.path === filePath)) {
        throw new ApiError(404, 'FILE_NOT_FOUND', msg('err.fileMissing'));
      }
      if (files.length <= 1) {
        throw new ApiError(400, 'LAST_FILE', msg('err.lastFile'));
      }
      if (project.settings.entry === filePath) {
        throw new ApiError(400, 'ENTRY_FILE', msg('err.entryFile'));
      }
      deleteFile(project.id, filePath);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/format', asyncRoute(async (req, res) => {
    enforceRate(req);
    enforceUserRate(req);
    const { file, content } = validateFormatRequest(req.body);
    const result = await formatSource(file, content, req.locale);
    res.json(result);
  }));

  app.post('/api/run', (req, res, next) => {
    try {
      enforceRate(req);
      enforceUserRate(req);
      const project = projectFor(req);
      const validated = validateRunRequest(req.body);
      if (!capabilities?.compilers.some((item) => item.id === validated.compiler && item.available)) {
        throw new ApiError(400, 'COMPILER_UNAVAILABLE', msg('err.compilerMissing', { compiler: validated.compiler }));
      }
      const prepared = buildPrepared({
        ownerId: req.user!.id,
        projectId: project.id,
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
      const started = startRun(prepared);
      if (!started) throw new ApiError(429, 'USER_BUSY', msg('err.userBusyRun'));
      audit({
        event: 'run.start',
        runId: started.runId,
        userId: req.user!.id,
        username: req.user!.username,
        projectId: project.id,
        entry: validated.files.entry,
        compiler: validated.compiler,
        std: validated.std,
        opt: validated.opt,
        flags: validated.extraFlags,
        sourceBytes: validated.files.sourceBytes,
      });
      res.status(202).json({ runId: started.runId, wsPath: `/ws/run/${started.runId}` });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/run/:id', (req, res, next) => {
    try {
      const project = projectFor(req);
      const session = getRunSession(req.params.id);
      if (session) {
        if (session.ownerId !== req.user!.id) throw new ApiError(404, 'RUN_NOT_FOUND', msg('err.runNotFound'));
        res.json({ runId: session.id, done: session.done, result: session.result ?? null });
        return;
      }
      const stored = getRun(project.id, req.params.id);
      if (!stored) throw new ApiError(404, 'RUN_NOT_FOUND', msg('err.runNotFound'));
      res.json({ runId: stored.id, done: true, result: stored });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs', (req, res, next) => {
    try {
      const project = projectFor(req);
      const limit = Number(req.query.limit ?? 40);
      res.json({ runs: listRuns(project.id, Number.isFinite(limit) ? limit : 40) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/runs/:id', (req, res, next) => {
    try {
      const project = projectFor(req);
      const run = getRun(project.id, req.params.id);
      if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', msg('err.runNotFound'));
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/runs/:id/restore', (req, res, next) => {
    try {
      const project = projectFor(req);
      // The owner check is the project-scoped lookup, before any file write.
      const run = getRun(project.id, req.params.id);
      if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', msg('err.runNotFound'));
      const validated = validateFiles(run.files, run.source.entry);
      replaceFiles(project.id, validated.files, run.source);
      res.json(projectState(projectFor(req), req.locale));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/debug/start', asyncRoute(async (req, res) => {
    enforceRate(req);
    enforceUserRate(req);
    const project = projectFor(req);
    const validated = validateDebugStart(req.body);
    if (!capabilities?.compilers.some((item) => item.id === validated.compiler && item.available)) {
      throw new ApiError(400, 'COMPILER_UNAVAILABLE', msg('err.compilerMissing', { compiler: validated.compiler }));
    }
    const outcome = await startDebugSession({
      ownerId: req.user!.id,
      projectId: project.id,
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
    audit({
      event: 'debug.start',
      sessionId: outcome.response.sessionId,
      userId: req.user!.id,
      username: req.user!.username,
      projectId: project.id,
      entry: validated.files.entry,
    });
    res.status(201).json(outcome.response);
  }));

  // Only the current user's sessions; loopback is no longer an authorization rule.
  app.get('/api/debug', (req, res) => {
    res.json({ sessions: listDebugSessions(req.user!.id) });
  });

  app.post('/api/debug/:id/stop', asyncRoute(async (req, res) => {
    const session = getDebugSession(String(req.params.id));
    if (!session || session.ownerId !== req.user!.id) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', msg('err.debugSessionNotFound'));
    }
    await stopDebugSession(session.id);
    audit({ event: 'debug.stop', sessionId: session.id, userId: req.user!.id });
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
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!wsOriginAllowed(origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
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

    // WebSocket upgrades bypass Express entirely: resolve the cookie session
    // here, then enforce ownership before attaching (multi-user-auth.md §8.3).
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[config.auth.cookieName];
    const authenticated = authenticateToken(token);
    const tokenHash = token ? hashToken(token) : undefined;

    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as WebSocket & { authTokenHash?: string }).authTokenHash = tokenHash;
      if (!authenticated) {
        ws.close(4401, 'authentication required');
        return;
      }
      const authorize = authProbe(tokenHash);
      if (runMatch) {
        const session = getRunSession(runMatch[1]);
        if (!session) {
          ws.close(4404, 'run not found');
          return;
        }
        if (session.ownerId !== authenticated.user.id) {
          ws.close(4403, 'not the run owner');
          return;
        }
        attachRunSocket(session, ws, authorize);
      } else if (debugMatch) {
        const session = getDebugSession(debugMatch[1]);
        if (!session) {
          ws.close(4404, 'session not found');
          return;
        }
        if (session.ownerId !== authenticated.user.id) {
          ws.close(4403, 'not the session owner');
          return;
        }
        session.attach(ws, authorize);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const tracked = ws as WebSocket & { isAlive?: boolean; authTokenHash?: string };
      if (tracked.authTokenHash && authenticateTokenHash(tracked.authTokenHash) === null) {
        ws.close(4401, 'authentication required');
        continue;
      }
      if (tracked.isAlive === false) {
        ws.terminate();
        continue;
      }
      tracked.isAlive = false;
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
    clearInterval(rateSweeper);
    clearInterval(sessionCleaner);
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
