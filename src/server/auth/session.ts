import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { AuthUser } from '../../shared/types.js';
import { config } from '../config.js';
import {
  findAuthSessionByTokenHash,
  replaceAuthSession,
  getUserById,
  revokeAuthSession,
  toAuthUser,
  touchAuthSession,
  type AuthSessionRecord,
} from '../db.js';
import type { UserRecord } from '../db.js';

const TOKEN_BYTES = 32;
const TOUCH_INTERVAL_MS = 60_000;
const REVOKED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || cookies[name] !== undefined) continue;
    const raw = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

export function cookieSecure(req: Request): boolean {
  if (config.auth.cookieSecure === 'always') return true;
  if (config.auth.cookieSecure === 'never') return false;
  return req.secure;
}

export function serializeSessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${config.auth.cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${config.auth.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
  };
}

export interface IssuedSession {
  session: AuthSessionRecord;
  token: string;
  maxAgeSeconds: number;
  /** Previous sessions revoked by the single-device policy. */
  revoked: number;
}

/**
 * Always rotate and replace: a successful login/session rotation revokes every
 * other session of the account (one active device), and never reuses a token.
 */
export function issueSession(user: UserRecord, req: Request): IssuedSession {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const now = Date.now();
  const expiresAt = now + config.auth.sessionAbsoluteMs;
  const { ip, userAgent } = requestMeta(req);
  const { session, revoked } = replaceAuthSession({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
    ip,
    userAgent,
  });
  return { session, token, maxAgeSeconds: Math.floor((expiresAt - now) / 1000), revoked };
}

export interface Authenticated {
  user: AuthUser;
  userRecord: UserRecord;
  session: AuthSessionRecord;
}

/**
 * Resolve a raw cookie token into a live session. Expired, revoked, idle and
 * disabled accounts all fail the same way: `null`.
 */
export function authenticateToken(token: string | undefined): Authenticated | null {
  if (!token) return null;
  return authenticateTokenHash(hashToken(token));
}

/**
 * Same checks as authenticateToken, for WebSocket code that kept only the hash.
 * `touch=false` validates without extending the idle timer (used by the WS
 * sweeper, so an idle tab still expires after SESSION_IDLE_HOURS).
 */
export function authenticateTokenHash(tokenHash: string, touch = true): Authenticated | null {
  const found = findAuthSessionByTokenHash(tokenHash);
  if (!found) return null;
  const { session } = found;
  const now = Date.now();
  if (session.revokedAt !== null) return null;
  if (session.expiresAt <= now) return null;
  if (now - session.lastSeenAt > config.auth.sessionIdleMs) return null;
  // Re-read the user so a disabled account loses access on the next request.
  const user = getUserById(session.userId) ?? found.user;
  if (user.status !== 'active') return null;
  if (touch && now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
    touchAuthSession(session.id);
  }
  return { user: toAuthUser(user), userRecord: user, session };
}

export function authenticateRequest(req: Request): Authenticated | null {
  const cookies = parseCookies(req.headers.cookie);
  return authenticateToken(cookies[config.auth.cookieName]);
}

export function sessionTokenFromRequest(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[config.auth.cookieName];
}

export function revokeSession(id: string): void {
  revokeAuthSession(id);
}

export function sessionCookieFor(req: Request, issued: IssuedSession): string {
  return serializeSessionCookie(issued.token, issued.maxAgeSeconds, cookieSecure(req));
}

export { REVOKED_GRACE_MS };
