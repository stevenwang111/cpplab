import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Request } from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpplab-auth-flow-'));
process.env.DB_PATH = path.join(tempDir, 'flow.db');
process.env.ALLOW_BOOTSTRAP = '1';
process.env.BOOTSTRAP_ADMIN_USERNAME = 'root';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'initial-password';

const db = await import('../../src/server/db.js');
const service = await import('../../src/server/auth/service.js');
const session = await import('../../src/server/auth/session.js');

function fakeRequest(cookie?: string): Request {
  return {
    ip: '127.0.0.1',
    secure: false,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'user-agent': 'unit-test', ...(cookie ? { cookie } : {}) },
  } as unknown as Request;
}

function cookieFor(token: string): string {
  return `cpplab_session=${encodeURIComponent(token)}`;
}

db.initDb();

test('bootstrap creates exactly one admin and a project', async () => {
  const created = await service.bootstrapAdminIfConfigured();
  assert.ok(created);
  assert.equal(created.username, 'root');
  assert.equal(created.role, 'admin');
  assert.equal(db.countUsers(), 1);
  assert.ok(db.getProjectForUser(created.id));
  assert.equal(await service.bootstrapAdminIfConfigured(), null);
});

test('login issues a session and wrong passwords fail uniformly', async () => {
  const ok = await service.login('root', 'initial-password', fakeRequest());
  assert.equal(ok.user.username, 'root');
  assert.ok(ok.issued.token.length >= 40);
  const authenticated = session.authenticateToken(ok.issued.token);
  assert.equal(authenticated?.user.username, 'root');

  await assert.rejects(
    () => service.login('root', 'wrong-password', fakeRequest()),
    (error: { code?: string; status?: number }) => error.code === 'INVALID_CREDENTIALS' && error.status === 401,
  );
  await assert.rejects(
    () => service.login('nobody', 'wrong-password', fakeRequest()),
    (error: { code?: string; status?: number }) => error.code === 'INVALID_CREDENTIALS' && error.status === 401,
  );
});

test('disabling a user kills their existing sessions', async () => {
  const root = db.getUserByUsername('root')!;
  const issued = await service.login('root', 'initial-password', fakeRequest());
  assert.ok(session.authenticateToken(issued.issued.token));
  // Disabling self through the service is forbidden; simulate an admin action.
  db.setUserStatus(root.id, 'disabled');
  db.revokeUserAuthSessions(root.id);
  assert.equal(session.authenticateToken(issued.issued.token), null);
  await assert.rejects(
    () => service.login('root', 'initial-password', fakeRequest()),
    (error: { code?: string }) => error.code === 'INVALID_CREDENTIALS',
  );
  db.setUserStatus(root.id, 'active');
});

test('changing the password revokes old sessions and issues a fresh token', async () => {
  const issued = await service.login('root', 'initial-password', fakeRequest());
  const admin = db.getUserByUsername('root')!;
  await assert.rejects(
    () => service.changePassword(admin, 'not-the-password', 'a-new-password-1', fakeRequest()),
    (error: { code?: string }) => error.code === 'INVALID_CREDENTIALS',
  );
  const changed = await service.changePassword(admin, 'initial-password', 'a-new-password-1', fakeRequest());
  assert.equal(session.authenticateToken(issued.issued.token), null);
  assert.equal(session.authenticateToken(changed.issued.token)?.user.username, 'root');
  await assert.rejects(
    () => service.login('root', 'initial-password', fakeRequest()),
    (error: { code?: string }) => error.code === 'INVALID_CREDENTIALS',
  );
  const relogin = await service.login('root', 'a-new-password-1', fakeRequest());
  assert.equal(relogin.user.username, 'root');
});

test('admin-created users get a personal project and a one-time password', async () => {
  const actor = db.getUserByUsername('root')!;
  const created = await service.createUserByAdmin({ username: 'bob', role: 'user' }, actor);
  assert.equal(created.user.username, 'bob');
  assert.ok(created.initialPassword && created.initialPassword.length >= 20);
  assert.equal(created.user.mustChangePassword, true);
  assert.ok(db.getProjectForUser(created.user.id));

  const bobLogin = await service.login('bob', created.initialPassword!, fakeRequest());
  assert.equal(bobLogin.user.mustChangePassword, true);

  const reset = await service.resetUserPassword(actor, created.user.id);
  assert.notEqual(reset.password, created.initialPassword);
  assert.equal(session.authenticateToken(bobLogin.issued.token), null);
  const afterReset = await service.login('bob', reset.password, fakeRequest());
  assert.equal(afterReset.user.mustChangePassword, true);
});

test('the last admin cannot be disabled or demoted through the service', () => {
  const actor = db.getUserByUsername('root')!;
  assert.throws(() => service.updateUserStatus(actor, actor.id, 'disabled'), /administrator/i);
  assert.throws(() => service.updateUserRole(actor, actor.id, 'user'), /administrator/i);
  const listed = service.listAdminUsers();
  assert.ok(listed.every((user) => !('passwordHash' in user) && !('password_hash' in user)));
});

test('cookie helpers keep the token HttpOnly and never put it in the URL', () => {
  const header = session.serializeSessionCookie('tok en/value', 3600, true);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  assert.match(header, /Path=\//);
  assert.match(header, /cpplab_session=tok%20en%2Fvalue/);
  const parsed = session.parseCookies('cpplab_session=tok%20en%2Fvalue; other=x');
  assert.equal(parsed.cpplab_session, 'tok en/value');
  assert.match(session.clearSessionCookie(false), /Max-Age=0/);
  assert.equal(session.cookieSecure(fakeRequest()), false);
  assert.ok(cookieFor('token'));
});
