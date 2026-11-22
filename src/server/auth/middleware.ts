import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../../shared/types.js';
import type { UserRecord } from '../db.js';
import { config } from '../config.js';
import { ApiError, msg } from '../util/errors.js';
import { authenticateRequest } from './session.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Safe user shape for route handlers. */
    user?: AuthUser;
    /** Full record (password hash included) for the auth service only. */
    authUserRecord?: UserRecord;
    authSessionId?: string;
  }
}

/** Read the session cookie only; never touches the request body. */
export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  const authenticated = authenticateRequest(req);
  if (authenticated) {
    req.user = authenticated.user;
    req.authUserRecord = authenticated.userRecord;
    req.authSessionId = authenticated.session.id;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new ApiError(401, 'AUTH_REQUIRED', msg('err.authRequired')));
    return;
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new ApiError(401, 'AUTH_REQUIRED', msg('err.authRequired')));
    return;
  }
  if (req.user.role !== 'admin') {
    next(new ApiError(403, 'FORBIDDEN', msg('err.forbidden')));
    return;
  }
  next();
}

/** Paths a user with a pending forced password change may still call. */
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/password']);

export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.mustChangePassword) {
    next();
    return;
  }
  const pathname = req.originalUrl.split('?')[0] ?? '';
  if (PASSWORD_CHANGE_ALLOWED.has(pathname)) {
    next();
    return;
  }
  next(new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', msg('err.passwordChangeRequired')));
}

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Strict same-origin check for state-changing requests. `SameSite=Strict`
 * already stops most CSRF; requiring Origin closes the login-CSRF and
 * non-browser gaps.
 */
export function requireSameOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const raw = req.headers.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (!origin) {
    next(new ApiError(403, 'CSRF_ORIGIN', msg('err.originRequired')));
    return;
  }
  const normalized = normalizedOrigin(origin);
  if (!normalized) {
    next(new ApiError(403, 'CSRF_ORIGIN', msg('err.originMismatch')));
    return;
  }
  if (config.auth.publicOrigin) {
    if (normalized !== config.auth.publicOrigin) {
      next(new ApiError(403, 'CSRF_ORIGIN', msg('err.originMismatch')));
      return;
    }
    next();
    return;
  }
  const host = req.headers.host;
  const expected = normalizedOrigin(`http://${host}`);
  const expectedSecure = normalizedOrigin(`https://${host}`);
  if (normalized !== expected && normalized !== expectedSecure) {
    next(new ApiError(403, 'CSRF_ORIGIN', msg('err.originMismatch')));
    return;
  }
  next();
}

/**
 * WebSocket upgrades do not pass through Express middleware. Browsers always
 * send Origin, so cross-site pages are rejected; non-browser clients may omit
 * it but still need a valid session cookie.
 */
export function wsOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  const normalized = normalizedOrigin(origin);
  if (!normalized) return false;
  if (config.auth.publicOrigin) return normalized === config.auth.publicOrigin;
  const parsed = new URL(normalized);
  return parsed.host === host;
}
