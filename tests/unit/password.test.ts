import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkPasswordPolicy,
  generateOneTimePassword,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../src/server/auth/password.js';

test('scrypt hash is self-describing and verifies the password', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$32768\$8\$1\$[^$]+\$[^$]+$/);
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batterY', hash), false);
});

test('two hashes of the same password use different salts', async () => {
  const first = await hashPassword('same password value');
  const second = await hashPassword('same password value');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('same password value', first), true);
  assert.equal(await verifyPassword('same password value', second), true);
});

test('a tampered hash fails closed', async () => {
  const hash = await hashPassword('correct horse battery');
  const parts = hash.split('$');
  parts[5] = Buffer.from('x'.repeat(32)).toString('base64');
  assert.equal(await verifyPassword('correct horse battery', parts.join('$')), false);
  assert.equal(needsRehash('not-a-hash'), true);
});

test('legacy parameters request a rehash', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(needsRehash(hash), false);
  assert.equal(needsRehash(hash.replace('$32768$8$1$', '$16384$8$1$')), true);
});

test('password policy is length based and does not trim', () => {
  assert.equal(checkPasswordPolicy('short').ok, false);
  assert.equal(checkPasswordPolicy(' spaces ').reason, 'too_short');
  assert.equal(checkPasswordPolicy('0123456789').ok, true);
  assert.equal(checkPasswordPolicy('x'.repeat(129)).reason, 'too_long');
  assert.equal(checkPasswordPolicy(42).ok, false);
});

test('one-time passwords are long and unique', () => {
  const first = generateOneTimePassword();
  const second = generateOneTimePassword();
  assert.ok(first.length >= 20);
  assert.notEqual(first, second);
});
