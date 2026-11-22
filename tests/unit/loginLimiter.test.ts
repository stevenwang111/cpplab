import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginLimiter } from '../../src/server/auth/loginLimiter.js';

test('per-IP window stops the eleventh attempt in a minute', () => {
  const limiter = new LoginLimiter();
  const now = 1_000_000;
  for (let index = 0; index < 10; index += 1) {
    assert.equal(limiter.check('203.0.113.9', `user${index}`, now).allowed, true);
  }
  const blocked = limiter.check('203.0.113.9', 'user10', now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(limiter.check('203.0.113.9', 'user10', now + 61_000).allowed, true);
});

test('per-username window stops the sixth attempt from a new IP', () => {
  const limiter = new LoginLimiter();
  const now = 2_000_000;
  for (let index = 0; index < 5; index += 1) {
    assert.equal(limiter.check(`198.51.100.${index}`, 'alice', now).allowed, true);
  }
  assert.equal(limiter.check('198.51.100.99', 'alice', now).allowed, false);
});

test('five consecutive failures impose a cooldown that expires, not a lockout', () => {
  const limiter = new LoginLimiter();
  const now = 3_000_000;
  for (let index = 0; index < 5; index += 1) {
    assert.equal(limiter.check(`192.0.2.${index}`, 'bob', now).allowed, true);
    limiter.recordFailure('bob', now);
  }
  const blocked = limiter.check('192.0.2.200', 'bob', now + 1_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.equal(limiter.check('192.0.2.201', 'bob', now + 61_000).allowed, true);
});

test('a successful login clears the failure cooldown', () => {
  const limiter = new LoginLimiter();
  const now = 4_000_000;
  for (let index = 0; index < 5; index += 1) {
    limiter.check(`203.0.113.${index}`, 'carol', now);
    limiter.recordFailure('carol', now);
  }
  assert.equal(limiter.check('203.0.113.50', 'carol', now + 30_000).allowed, false);
  limiter.recordSuccess('carol');
  assert.equal(limiter.check('203.0.113.51', 'carol', now + 30_000).allowed, true);
});
