import assert from 'node:assert/strict';
import test from 'node:test';
import { UserSlots } from '../../src/server/util/userQuota.js';

test('a user gets at most one slot while other users stay independent', () => {
  const slots = new UserSlots(1);
  const releaseAlice = slots.tryAcquire('alice');
  assert.ok(releaseAlice);
  assert.equal(slots.tryAcquire('alice'), null);
  assert.equal(slots.activeFor('alice'), 1);
  assert.ok(slots.tryAcquire('bob'));
  releaseAlice();
  assert.equal(slots.activeFor('alice'), 0);
  const again = slots.tryAcquire('alice');
  assert.ok(again);
  again();
});

test('releasing twice does not free another task slot', () => {
  const slots = new UserSlots(1);
  const release = slots.tryAcquire('carol')!;
  release();
  release();
  assert.equal(slots.activeFor('carol'), 0);
  const second = slots.tryAcquire('carol');
  assert.ok(second);
  second();
});

test('the configured slot count is respected', () => {
  const slots = new UserSlots(2);
  const first = slots.tryAcquire('dave');
  const second = slots.tryAcquire('dave');
  assert.ok(first);
  assert.ok(second);
  assert.equal(slots.tryAcquire('dave'), null);
  first!();
  assert.ok(slots.tryAcquire('dave'));
});
