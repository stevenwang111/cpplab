import type { Request } from 'express';
import type { AuthUser, UserRole } from '../../shared/types.js';
import { config } from '../config.js';
import {
  countUsers,
  createUser,
  getUserById,
  getUserByUsername,
  markUserLogin,
  revokeUserAuthSessions,
  setUserRole,
  setUserStatus,
  toAuthUser,
  toAdminUser,
  updateUserPassword,
  listUsers,
  type UserRecord as UserRecordType,
} from '../db.js';
import { ApiError, msg } from '../util/errors.js';
import { audit } from '../util/audit.js';
import {
  checkPasswordPolicy,
  generateOneTimePassword,
  hashPassword,
  needsRehash,
  verifyPassword,
  burnPasswordCheck,
} from './password.js';
import { issueSession, revokeSession, type IssuedSession } from './session.js';

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;

export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_REQUEST', msg('err.usernameInvalid'));
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) throw new ApiError(400, 'USERNAME_INVALID', msg('err.usernameInvalid'));
  return username;
}

function assertPasswordPolicy(password: unknown): string {
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    throw new ApiError(
      400,
      policy.reason === 'too_long' ? 'PASSWORD_TOO_LONG' : 'PASSWORD_TOO_SHORT',
      policy.reason === 'too_long' ? msg('err.passwordTooLong') : msg('err.passwordTooShort'),
    );
  }
  return password as string;
}

function loginFailedIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export interface LoginSuccess {
  user: AuthUser;
  issued: IssuedSession;
}

/**
 * Credential check with a single, uniform failure. Unknown usernames still pay
 * for one scrypt run, and disabled accounts are indistinguishable from bad
 * passwords (`multi-user-auth.md` §7.2).
 */
export async function login(
  usernameInput: unknown,
  passwordInput: unknown,
  req: Request,
): Promise<LoginSuccess> {
  const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  if (!username || !password) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', msg('err.invalidCredentials'));
  }

  const user = getUserByUsername(username);
  if (!user) {
    await burnPasswordCheck(password);
    audit({ event: 'auth.login', ok: false, username: username.slice(0, 64), ip: loginFailedIp(req), reason: 'unknown_user' });
    throw new ApiError(401, 'INVALID_CREDENTIALS', msg('err.invalidCredentials'));
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid || user.status !== 'active') {
    audit({
      event: 'auth.login',
      ok: false,
      username: user.username,
      ip: loginFailedIp(req),
      reason: valid ? 'disabled' : 'bad_password',
    });
    throw new ApiError(401, 'INVALID_CREDENTIALS', msg('err.invalidCredentials'));
  }

  if (needsRehash(user.passwordHash)) {
    try {
      const upgraded = await hashPassword(password);
      updateUserPassword(user.id, upgraded, user.mustChangePassword);
    } catch {
      // A failed opportunistic rehash must not block a valid login.
    }
  }

  markUserLogin(user.id);
  const issued = issueSession(user, req);
  if (issued.revoked > 0) {
    audit({
      event: 'auth.session.revoke',
      userId: user.id,
      reason: 'single_device_login',
      count: issued.revoked,
    });
  }
  const fresh = getUserById(user.id) ?? user;
  audit({
    event: 'auth.login',
    ok: true,
    userId: fresh.id,
    username: fresh.username,
    sessionId: issued.session.id,
    ip: loginFailedIp(req),
  });
  return { user: toAuthUser(fresh), issued };
}

export async function changePassword(
  current: UserRecordType,
  currentPasswordInput: unknown,
  newPasswordInput: unknown,
  req: Request,
): Promise<{ user: AuthUser; issued: IssuedSession }> {
  const currentPassword = typeof currentPasswordInput === 'string' ? currentPasswordInput : '';
  const newPassword = assertPasswordPolicy(newPasswordInput);
  const valid = await verifyPassword(currentPassword, current.passwordHash);
  if (!valid) throw new ApiError(401, 'INVALID_CREDENTIALS', msg('err.currentPasswordWrong'));
  if (currentPassword === newPassword) {
    throw new ApiError(400, 'PASSWORD_UNCHANGED', msg('err.passwordUnchanged'));
  }
  const hash = await hashPassword(newPassword);
  // Changing the password invalidates every existing session, including this
  // one, and issues a fresh token inside the same transaction.
  updateUserPassword(current.id, hash, false);
  const fresh = getUserById(current.id) ?? current;
  const issued = issueSession(fresh, req);
  if (issued.revoked > 0) {
    audit({ event: 'auth.session.revoke', userId: current.id, reason: 'password_change', count: issued.revoked });
  }
  audit({ event: 'auth.password.change', userId: fresh.id, sessionId: issued.session.id });
  return { user: toAuthUser(fresh), issued };
}

export interface CreatedUser {
  user: AuthUser;
  /** Only present when the password was generated by the server (never hashed back out). */
  initialPassword?: string;
}

export async function createUserByAdmin(
  input: { username?: unknown; displayName?: unknown; role?: unknown; password?: unknown },
  actor: UserRecordType,
): Promise<CreatedUser> {
  const username = normalizeUsername(input.username);
  const role: UserRole = input.role === 'admin' ? 'admin' : 'user';
  if (input.role !== undefined && input.role !== 'admin' && input.role !== 'user') {
    throw new ApiError(400, 'INVALID_REQUEST', msg('err.enumInvalid', { field: 'role' }));
  }
  if (getUserByUsername(username)) throw new ApiError(409, 'USERNAME_TAKEN', msg('err.usernameTaken'));
  const explicitPassword = input.password !== undefined;
  const password = explicitPassword ? assertPasswordPolicy(input.password) : generateOneTimePassword();
  const displayName =
    typeof input.displayName === 'string' && input.displayName.trim()
      ? input.displayName.trim().slice(0, 60)
      : username;
  const passwordHash = await hashPassword(password);
  const created = createUser({
    username,
    displayName,
    passwordHash,
    role,
    mustChangePassword: !explicitPassword,
  });
  audit({
    event: 'user.create',
    actorId: actor.id,
    targetId: created.user.id,
    username: created.user.username,
    role,
    adoptedProjects: created.adopted,
  });
  return {
    user: toAuthUser(created.user),
    initialPassword: explicitPassword ? undefined : password,
  };
}

export async function resetUserPassword(
  actor: UserRecordType,
  targetId: string,
): Promise<{ user: AuthUser; password: string }> {
  const target = getUserById(targetId);
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', msg('err.userNotFound'));
  const password = generateOneTimePassword();
  const hash = await hashPassword(password);
  updateUserPassword(target.id, hash, true);
  const revoked = revokeUserAuthSessions(target.id);
  audit({
    event: 'user.password.reset',
    actorId: actor.id,
    targetId: target.id,
    revokedSessions: revoked,
  });
  return { user: toAuthUser({ ...target, mustChangePassword: true }), password };
}

export function updateUserStatus(actor: UserRecordType, targetId: string, status: unknown): AuthUser {
  if (status !== 'active' && status !== 'disabled') {
    throw new ApiError(400, 'INVALID_REQUEST', msg('err.enumInvalid', { field: 'status' }));
  }
  const target = getUserById(targetId);
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', msg('err.userNotFound'));
  if (target.id === actor.id && status === 'disabled') {
    throw new ApiError(400, 'CANNOT_DISABLE_SELF', msg('err.cannotDisableSelf'));
  }
  setUserStatus(target.id, status);
  if (status === 'disabled') {
    const revoked = revokeUserAuthSessions(target.id);
    audit({ event: 'user.disable', actorId: actor.id, targetId: target.id, revokedSessions: revoked });
  } else {
    audit({ event: 'user.enable', actorId: actor.id, targetId: target.id });
  }
  return toAuthUser(getUserById(target.id)!);
}

export function updateUserRole(actor: UserRecordType, targetId: string, role: unknown): AuthUser {
  if (role !== 'admin' && role !== 'user') {
    throw new ApiError(400, 'INVALID_REQUEST', msg('err.enumInvalid', { field: 'role' }));
  }
  const target = getUserById(targetId);
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', msg('err.userNotFound'));
  if (target.id === actor.id && role !== 'admin') {
    throw new ApiError(400, 'CANNOT_DEMOTE_SELF', msg('err.cannotDemoteSelf'));
  }
  setUserRole(target.id, role);
  audit({ event: 'user.role', actorId: actor.id, targetId: target.id, role });
  return toAuthUser(getUserById(target.id)!);
}

export function listAdminUsers(): ReturnType<typeof toAdminUser>[] {
  return listUsers().map(toAdminUser);
}

export function logout(sessionId: string, user: AuthUser): void {
  revokeSession(sessionId);
  audit({ event: 'auth.logout', userId: user.id, sessionId });
}

/**
 * One-shot bootstrap for containers/tests. Only runs while the users table is
 * empty; the credentials are never persisted or logged.
 */
export async function bootstrapAdminIfConfigured(): Promise<AuthUser | null> {
  if (!config.auth.bootstrap.allow || countUsers() > 0) return null;
  const username = config.auth.bootstrap.username;
  const password = config.auth.bootstrap.password;
  if (!username || !password) {
    console.warn('[cpplab] ALLOW_BOOTSTRAP=1 but BOOTSTRAP_ADMIN_USERNAME/PASSWORD is not set');
    return null;
  }
  const normalized = normalizeUsername(username);
  assertPasswordPolicy(password);
  const hash = await hashPassword(password);
  const created = createUser({
    username: normalized,
    displayName: normalized,
    passwordHash: hash,
    role: 'admin',
    mustChangePassword: false,
  });
  audit({
    event: 'user.create',
    actorId: 'bootstrap',
    targetId: created.user.id,
    username: created.user.username,
    role: 'admin',
    adoptedProjects: created.adopted,
  });
  return toAuthUser(created.user);
}
